# Website Archiver

A small Node.js website that packages a limited number of pages and static assets from a public website into a ZIP download.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Open <http://localhost:3000>.

## Deploy on Render

This repository includes a `render.yaml` Blueprint configuration. To publish it:

1. Sign in to [Render](https://render.com/) and connect your GitHub account.
2. Choose **New** → **Blueprint** and select `Web-mc1/website-archiver`.
3. Review the `website-archiver` web service and choose **Apply**.
4. Wait for the deployment to finish, then open the `onrender.com` URL Render provides.

The service uses the free plan, which may sleep when idle. You need a Render account and must authorize access to the private GitHub repository.

## What it archives

- Up to 10 same-origin HTML pages
- Up to 100 same-origin static files
- A maximum of 2 MB per file and 20 MB total

It follows ordinary links and collects common image, script, stylesheet, icon, audio, and video references. Dynamic content, protected pages, server-side code, and content behind logins are not downloaded. Some websites may block automated requests.

## Responsible use and safety

Only archive sites you own or have permission to save. The server accepts public HTTP/HTTPS destinations, rejects private/local addresses and redirects to unsafe hosts, and applies page, file, and timeout limits. It is not a way to retrieve hidden or server-side files.

This is a simple starter app, not a production hosting service. Before making it publicly available, add authentication, request rate limiting, deployment-specific network egress controls, and monitoring.
