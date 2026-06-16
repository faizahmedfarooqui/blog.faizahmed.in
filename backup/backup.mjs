#!/usr/bin/env node
// Backup tooling for blog.faizahmed.in
//
// Hashnode made its GraphQL API and Git-backup integration Pro-only, so this
// script backs the blog up the free way: it drives a headless browser to the
// published site (passing Vercel's bot checkpoint), reads the post data that
// the Astro frontend embeds in the page (Next.js RSC payload), and writes one
// `<cuid>.md` file per post at the repo root — the exact same format Hashnode's
// integration used to produce.
//
// The markdown is the original Hashnode source (recovered byte-for-byte), not a
// lossy HTML->markdown conversion, so re-runs only touch posts that actually
// changed.
//
// Usage:
//   node backup.mjs                 # full sync (every post: repo slugs + sitemap)
//   node backup.mjs --incremental   # fetch only new/edited posts (uses sitemap <lastmod>)
//   node backup.mjs --dry-run       # report what would change, write nothing
//   node backup.mjs --commit        # after writing, make per-post git commits
//   node backup.mjs --only <slug>   # sync a single slug (repeatable)
//   node backup.mjs --limit <n>     # cap number of posts (debugging)
//   node backup.mjs --delay <ms>    # ms between fetches (default 1500; raise for full syncs)
//
// Incremental mode keeps backup/state.json (slug -> last-seen sitemap lastmod).
// It fetches a post only when it is new or its lastmod changed, and seeds posts
// already present in the repo without re-fetching. This is what the daily
// GitHub Action runs — most days it fetches nothing.

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import {
  readFileSync, writeFileSync, readdirSync, existsSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOST = 'blog.faizahmed.in';
const BASE = `https://${HOST}`;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const REPO = dirname(dirname(fileURLToPath(import.meta.url))); // repo root (parent of backup/)

// Paths that exist in the sitemap but are not blog posts.
const NON_POST_SLUGS = new Set(['archive', 'recommendations', 'newsletter', 'series', 'tags']);

// ----- CLI args ---------------------------------------------------------------
const argv = process.argv.slice(2);
const flags = {
  dryRun: false, commit: false, incremental: false, limit: Infinity, delay: 1500, only: [],
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--dry-run') flags.dryRun = true;
  else if (a === '--commit') flags.commit = true;
  else if (a === '--incremental') flags.incremental = true;
  else if (a === '--limit') flags.limit = Number.parseInt(argv[++i], 10);
  else if (a === '--delay') flags.delay = Number.parseInt(argv[++i], 10);
  else if (a === '--only') flags.only.push(argv[++i]);
}

const STATE_FILE = join(dirname(fileURLToPath(import.meta.url)), 'state.json');

// ----- helpers ----------------------------------------------------------------

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n) => String(n).padStart(2, '0');

// Reproduce the date string Hashnode wrote, e.g.
// "Wed Feb 04 2026 13:30:28 GMT+0000 (Coordinated Universal Time)"
function formatPublishedAt(iso) {
  const d = new Date(iso);
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${p2(d.getUTCDate())} ${d.getUTCFullYear()} `
    + `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} `
    + 'GMT+0000 (Coordinated Universal Time)';
}

// Build the full `<cuid>.md` file body from a post object + its markdown.
function renderFile(post, markdown) {
  const lines = ['---'];
  lines.push(`title: "${post.title}"`);
  lines.push(`datePublished: ${formatPublishedAt(post.publishedAt)}`);
  lines.push(`cuid: ${post.cuid}`);
  lines.push(`slug: ${post.slug}`);
  if (post.canonicalUrl) lines.push(`canonical: ${post.canonicalUrl}`);
  if (post.coverImage && post.coverImage.url) lines.push(`cover: ${post.coverImage.url}`);
  if (post.tags && post.tags.length) {
    lines.push(`tags: ${post.tags.map((t) => t.slug).join(', ')}`);
  }
  lines.push(`series: ${post.series ? post.series.slug : 'null'}`);
  return `${lines.join('\n')}\n\n---\n\n${markdown}`;
}

// Split a backup file into a frontmatter map + body.
function parseBackup(text) {
  const m = text.match(/^---\n([\s\S]*?)\n\n---\n\n/);
  if (!m) return { fm: {}, body: text };
  const fm = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(': ');
    if (i !== -1) fm[line.slice(0, i)] = line.slice(i + 2);
  }
  return { fm, body: text.slice(m[0].length) };
}

// True when two backup files represent the same post content. Tags are compared
// as a set so the differing tag *order* of the old Hashnode backups (vs. the
// live site today) is not treated as a change — only real edits are.
function sameBackup(prevText, nextText) {
  if (prevText === nextText) return true;
  const a = parseBackup(prevText); const b = parseBackup(nextText);
  if (a.body !== b.body) return false;
  const keys = new Set([...Object.keys(a.fm), ...Object.keys(b.fm)]);
  for (const k of keys) {
    if (k === 'tags') {
      const sa = new Set((a.fm.tags || '').split(', ').filter(Boolean));
      const sb = new Set((b.fm.tags || '').split(', ').filter(Boolean));
      if (sa.size !== sb.size || [...sa].some((t) => !sb.has(t))) return false;
    } else if (a.fm[k] !== b.fm[k]) return false;
  }
  return true;
}

// Concatenate the Next.js RSC payload from the page (decoded chunk strings).
async function readPayload(page) {
  return page.evaluate(() => (Array.isArray(window.__next_f)
    ? window.__next_f.map((x) => (Array.isArray(x) && typeof x[1] === 'string' ? x[1] : '')).join('')
    : ''));
}

// Resolve an RSC row reference like "$19" to its string value.
function readRow(payload, id) {
  const m = payload.search(new RegExp(`(?:^|\\n)${id}:`));
  if (m === -1) return null;
  const pos = m + (payload[m] === '\n' ? 1 : 0) + id.length + 1; // skip "id:"
  if (payload[pos] === 'T') {
    // T<hexByteLen>,<text> — text length is a byte count and may contain newlines
    const comma = payload.indexOf(',', pos);
    const byteLen = parseInt(payload.slice(pos + 1, comma), 16);
    return Buffer.from(payload.slice(comma + 1), 'utf8').subarray(0, byteLen).toString('utf8');
  }
  // Plain JSON-valued row: read until the next newline and parse if it looks like JSON.
  const end = payload.indexOf('\n', pos);
  const raw = payload.slice(pos, end === -1 ? undefined : end);
  try { return JSON.parse(raw); } catch { return raw; }
}

// Scan a balanced { ... } object out of the payload starting at `from`.
function extractObject(s, from) {
  let depth = 0; let inStr = false; let esc = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(from, i + 1); }
  }
  return null;
}

// Pull the main Post object (the singular "post":{...}) for the expected slug.
function extractPost(payload, expectedSlug) {
  // Prefer the singular "post":{...} anchor; fall back to scanning all Post blobs.
  const anchors = [];
  const singular = payload.indexOf('"post":{"__typename":"Post"');
  if (singular !== -1) anchors.push(singular + '"post":'.length);
  let idx = -1;
  // eslint-disable-next-line no-cond-assign
  while ((idx = payload.indexOf('{"__typename":"Post"', idx + 1)) !== -1) anchors.push(idx);

  for (const start of anchors) {
    const objStr = extractObject(payload, start);
    if (!objStr) continue;
    let post;
    try { post = JSON.parse(objStr); } catch { continue; }
    if (post && post.cuid && post.slug === expectedSlug) return post;
  }
  return null;
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

// Wait until the embedded post payload for `slug` has streamed in, or time out.
async function waitForPost(page, slug, ms = 12000) {
  const deadline = Date.now() + ms;
  let payload = '';
  while (Date.now() < deadline) {
    payload = await readPayload(page);
    if (payload.includes(`"slug":"${slug}"`) && payload.includes('{"__typename":"Post"')) {
      return payload;
    }
    await page.waitForTimeout(300);
  }
  return payload;
}

// Load a post page and return { post, markdown } or null.
// Retries with backoff: the Astro frontend streams the post chunk lazily, and
// Vercel's bot checkpoint may intercept under load — a reload usually clears both.
async function fetchPost(page, slug, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await page.goto(`${BASE}/${slug}`, { waitUntil: 'networkidle', timeout: 60000 });
      const onCheckpoint = /Security Checkpoint|Just a moment/i.test(await page.title());
      if (onCheckpoint) await page.waitForTimeout(5000); // let the JS challenge resolve

      const payload = await waitForPost(page, slug);
      const post = extractPost(payload, slug);
      if (post) {
        let markdown = post.content && post.content.markdown;
        if (typeof markdown === 'string' && markdown.startsWith('$')) {
          markdown = readRow(payload, markdown.slice(1));
        }
        if (typeof markdown === 'string') return { post, markdown };
      }
    } catch {
      // network error — fall through to backoff
    }
    if (attempt < attempts) await sleep(4000 * attempt); // 4s, 8s, 12s backoff
  }
  return null;
}

// ----- enumeration ------------------------------------------------------------

function repoSlugs() {
  const map = new Map(); // slug -> cuid
  for (const f of readdirSync(REPO)) {
    if (!f.endsWith('.md')) continue;
    const slug = (readFileSync(join(REPO, f), 'utf8').match(/^slug:\s*(.+)$/m) || [])[1];
    if (slug) map.set(slug.trim(), f.replace(/\.md$/, ''));
  }
  return map;
}

// Return [{ slug, lastmod }] for every post URL in the sitemap.
async function sitemapEntries(page) {
  try {
    await page.goto(`${BASE}/sitemap.xml`, { waitUntil: 'networkidle', timeout: 60000 });
    const body = await page.content();
    const entries = [];
    for (const block of body.match(/<url>[\s\S]*?<\/url>/g) || []) {
      const loc = (block.match(/<loc>(.*?)<\/loc>/) || [])[1];
      if (!loc || !loc.startsWith(BASE)) continue;
      const slug = loc.slice(BASE.length).replace(/^\//, '').replace(/\/$/, '');
      if (!slug || slug.includes('/') || NON_POST_SLUGS.has(slug)) continue;
      const lastmod = (block.match(/<lastmod>(.*?)<\/lastmod>/) || [])[1] || '';
      entries.push({ slug, lastmod });
    }
    return entries;
  } catch {
    return [];
  }
}

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}

// ----- main -------------------------------------------------------------------

(async () => {
  const existing = repoSlugs();
  const state = loadState();
  let stateChanged = false;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();

  const lastmodOf = new Map(); // slug -> sitemap lastmod (when known)
  let slugs;
  if (flags.only.length) {
    slugs = flags.only;
  } else {
    const entries = await sitemapEntries(page);
    for (const e of entries) lastmodOf.set(e.slug, e.lastmod);

    if (flags.incremental) {
      slugs = [];
      for (const { slug, lastmod } of entries) {
        if (state[slug] === lastmod) continue; // already backed up at this version
        if (state[slug] === undefined && existing.has(slug)) {
          // Already in the repo but not yet tracked — trust it, just seed state.
          state[slug] = lastmod;
          stateChanged = true;
          continue;
        }
        slugs.push(slug); // new post, or lastmod changed
      }
    } else {
      slugs = [...new Set([...existing.keys(), ...entries.map((e) => e.slug)])];
    }
  }
  slugs = slugs.slice(0, flags.limit);

  const mode = flags.incremental ? 'incremental' : 'full';
  console.log(`Backup (${mode}): ${slugs.length} post(s) to fetch into ${REPO}`);
  if (flags.dryRun) console.log('(dry run — no files will be written)\n');

  const created = []; const updated = []; const unchanged = [];

  // Process one slug; returns true on success, false on fetch failure.
  const processSlug = async (slug) => {
    const result = await fetchPost(page, slug);
    if (!result) { console.log(`  FAIL      ${slug}`); return false; }

    const { post, markdown } = result;
    const file = join(REPO, `${post.cuid}.md`);
    const next = renderFile(post, markdown);
    const prev = existsSync(file) ? readFileSync(file, 'utf8') : null;

    if (prev === null) {
      if (!flags.dryRun) writeFileSync(file, next);
      created.push({ slug, file: `${post.cuid}.md`, title: post.title });
      console.log(`  CREATE    ${post.cuid}.md  (${slug})`);
    } else if (!sameBackup(prev, next)) {
      if (!flags.dryRun) writeFileSync(file, next);
      updated.push({ slug, file: `${post.cuid}.md`, title: post.title });
      console.log(`  UPDATE    ${post.cuid}.md  (${slug})`);
    } else {
      unchanged.push(slug);
    }

    // Record that we've now captured this slug at its current lastmod.
    if (lastmodOf.has(slug) && state[slug] !== lastmodOf.get(slug)) {
      state[slug] = lastmodOf.get(slug);
      stateChanged = true;
    }
    return true;
  };

  // First pass.
  let failed = [];
  for (const slug of slugs) {
    if (!(await processSlug(slug))) failed.push(slug);
    await sleep(flags.delay); // pace requests to stay under Vercel's rate limit
  }

  // Second pass for stragglers (transient rate-limit / late chunk), gentler pace.
  if (failed.length) {
    console.log(`\nRetrying ${failed.length} failed post(s) after a cooldown...`);
    await sleep(30000);
    const stillFailed = [];
    for (const slug of failed) {
      if (!(await processSlug(slug))) stillFailed.push(slug);
      await sleep(3000);
    }
    failed = stillFailed;
  }

  await browser.close();

  // Persist the lastmod state so the next incremental run can skip unchanged posts.
  if (stateChanged && !flags.dryRun && !flags.only.length) {
    const sorted = Object.fromEntries(Object.entries(state).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(STATE_FILE, `${JSON.stringify(sorted, null, 2)}\n`);
  }

  console.log(`\nDone. created=${created.length} updated=${updated.length} `
    + `unchanged=${unchanged.length} failed=${failed.length}`);
  if (failed.length) console.log(`Failed slugs: ${failed.join(', ')}`);

  // Optional: mirror Hashnode's per-post commit style, plus a state commit.
  if (flags.commit && !flags.dryRun) {
    const git = (...args) => execFileSync('git', ['-C', REPO, ...args]);
    for (const c of created) { git('add', c.file); git('commit', '-m', `create post: ${c.title}`); }
    for (const u of updated) { git('add', u.file); git('commit', '-m', `update post: ${u.title}`); }
    if (stateChanged) {
      git('add', STATE_FILE);
      git('commit', '-m', 'chore: update backup state');
    }
    const n = created.length + updated.length;
    if (n) console.log(`Committed ${n} post change(s).`);
  }

  process.exitCode = failed.length ? 1 : 0;
})();
