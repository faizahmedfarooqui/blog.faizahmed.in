---
title: "Understanding Express Typescript"
seoTitle: "Express Typescript"
seoDescription: "A full-stack web framework built using ExpressJS, TypeScript & MongoDB."
datePublished: Sun Jan 12 2020 18:30:00 GMT+0000 (Coordinated Universal Time)
cuid: ckqezqmzv0k7kd6s1hqrz0duf
slug: express-typescript
canonical: https://medium.com/@faizahmedfarooqui/boilerplate-using-express-typescript-e15bd4afcb96
cover: https://cdn.hashnode.com/res/hashnode/image/upload/v1624783885522/83P-q9O7c.png
ogImage: https://cdn.hashnode.com/res/hashnode/image/upload/v1624786086084/M60B289zN.png
tags: express, mongodb, nodejs, boilerplate, typescript

---

**In ExpressJS**, we always have to start from scratch for things like *CSRF*/*JWT Token*, *Exception Handling*, *Clusters*, *Queues*, *Cache*, etc. So, I thought to make a boilerplate to kick start with technologies like *Typescript*, *MongoDB* and *Pug Template*.

You can find the repository on GitHub — [geekyants/express-typescript](https://github.com/GeekyAnts/express-typescript).

# Features:

## #1. Exception Handling

![exception.png](https://cdn.hashnode.com/res/hashnode/image/upload/v1624785284661/QWofZrlJK.png) Rather than restarting the entire node app again & again for minor bugs.
We found our way out to handle exceptions & errors using Node’s process events.
So now we catch these errors & exceptions using Handlers and show our users a custom page.

## #2. Fork a New Cluster on Exit of Old Cluster

![cluster.png](https://cdn.hashnode.com/res/hashnode/image/upload/v1624785492219/BjcMrvVuA.png) Rather than sending the entire load onto a single Core / CPU, we try to take advantage of a multi-core system to handle the load. Here, if the cluster dies due to some reason, we create / fork a new one immediately.

## #3. Authentication (E-Mail with OAuth)

![auth.png](https://cdn.hashnode.com/res/hashnode/image/upload/v1624785537128/CCCsRJj8t.png)
Using PassportJS as an interface, we keep adding configurations & registering them in the app for social authentication.

## #4. Logger

![logger.png](https://cdn.hashnode.com/res/hashnode/image/upload/v1624785584131/XcecZ2EGO.png) A Single Log class with methods like info, warn, error & custom.

These methods send the log string to a file under <YYYY-MM-DD>.log directory of your project root and keep creating these log files daily rather than having a single log file.

You can zip them every week too!

## #5. DotEnv

Use of **.env** file, to load environment variables/constants for the entire app. So now, we have a single centralized constants location.

## #6. Tokens

We prefer using CSRF token (stateful) for our Web routes whereas JWT token (stateless) for the API routes. So, here we create middlewares for both the tokens and registered them against Web and API routes respectively.

## #7. Structure

![structure.png](https://cdn.hashnode.com/res/hashnode/image/upload/v1624785818804/AlM-D8zQw.png)

Structuring of folders/files structure in ExpressJS was a bit of a discussion.

Where to organize which files?
Or is there even a perfect structure?
At last, I came up with the following folder structure.

*Note: The screenshot contains just parent level folders only.*

## #8. Queues

![queue.png](https://cdn.hashnode.com/res/hashnode/image/upload/v1624785772609/QhaJZDqYW.png)
There are various things in backend logic that do not really need to happen onto the request.

Things like sending out E-Mails or SMS texts, etc. So basically, things that require a connection to any third party service.

For this, I have used [KueJS](https://github.com/Automattic/kue), a priority-based job queue that runs on a Redis driver.

## #9. Cache

![cache.png](https://cdn.hashnode.com/res/hashnode/image/upload/v1624785933709/nmhW59SCE.png)
For the caching of web routes, I‘ve used a simple [in-memory](https://github.com/ptarjan/node-cache) cache using memory-cache.

And many more…

- - -

# About Me 👨‍💻

I'm Faiz A. Farooqui. Software Engineer from Bengaluru, India. Find out more about me @ [faizahmed.in](https://faizahmed.in)