# blog.faizahmed.in — post backups

A backup of every post on [blog.faizahmed.in](https://blog.faizahmed.in), one
`<cuid>.md` file per post at the repo root (Markdown + Hashnode frontmatter).

This used to be filled automatically by Hashnode's Git backup integration. That
became a **Pro-only** feature (as did the GraphQL API it relied on), so the
backups stopped. The [`backup/`](backup/) tooling here replaces it — for free,
without a Hashnode Pro plan or API token.

## How the backup works

The blog is served by a custom Astro frontend on Vercel. Each post page embeds
the full post data — including the original Markdown source — in its Next.js RSC
payload. The script ([`backup/backup.mjs`](backup/backup.mjs)):

1. Drives headless Chromium (Playwright) to the published site, which
   transparently passes Vercel's bot checkpoint that blocks plain `curl`.
2. Reads the embedded post object and recovers the **original Markdown
   byte-for-byte** (not a lossy HTML→Markdown conversion), so re-runs only touch
   posts that actually changed.
3. Writes `<cuid>.md` in the same format Hashnode's integration produced.

### Incremental vs. full

- **Incremental** (`--incremental`) — the default for automation. Uses the
  sitemap's `<lastmod>` against [`backup/state.json`](backup/state.json) (slug →
  last-seen lastmod) to fetch **only new or edited posts**. Posts already in the
  repo are seeded into state without re-fetching. Most days this fetches nothing.
- **Full** (no flag) — fetches every post (repo slugs ∪ sitemap). Heavier and
  more exposed to rate-limiting; useful as an occasional safety net.

## Automated backup (GitHub Actions)

[`.github/workflows/backup.yml`](.github/workflows/backup.yml) runs daily at
03:00 UTC (and on manual dispatch). It runs the **incremental** backup, so it
only fetches posts that are new or have changed since the last run, commits each
one (`create post: <title>` / `update post: <title>`), and pushes.

It needs no secrets — only the default `contents: write` permission, which the
workflow requests. **Required once:** set *Settings → Actions → General →
Workflow permissions* to **Read and write**, or the auto-push will fail.

Commits are authored by `github-actions[bot]`. To keep your own authorship,
change the `git config user.name/user.email` lines in the workflow.

## Local use

```bash
cd backup
npm install
npx playwright install chromium      # one time

node backup.mjs --incremental        # fetch only new/edited posts
node backup.mjs                       # full sync (every post)
node backup.mjs --dry-run             # preview changes, write nothing
node backup.mjs --incremental --commit  # write + per-post git commits
node backup.mjs --only some-post-slug    # sync a single post (repeatable)
```

After a plain run, review with `git status` / `git diff` and commit yourself, or
use `--commit` to mirror Hashnode's per-post commit style.

## Notes / limitations

- Frontmatter includes a `series:` line with the post's Hashnode series slug, or
  `null` if it isn't part of a series. A `Part N` in a title does **not** imply a
  series — only the per-post `series` field is authoritative (e.g. the
  "metal-to-cloud" posts are grouped by title but not by a Hashnode series).
- A post counts as changed when its Markdown body, title, cover, canonical URL,
  publish date, series, or **set** of tags differs. Tag *order* is ignored — the
  old Hashnode backups happened to order tags differently than the live site
  does now, and rewriting all of them for that would be pure noise.
- If a post is unpublished/deleted on Hashnode, its `<cuid>.md` is left in place
  (the script never deletes backups).
- When a post is genuinely rewritten, its tags are emitted in the live site's
  order.
