---
title: BrowserHive
description: A web-capture server that saves screenshots, HTML, and WACZ archives to S3 — just POST a URL
template: splash
hero:
  tagline: Just POST a URL. Screenshots, HTML, and WACZ archives are saved to S3 asynchronously
  actions:
    - text: Quickstart
      # frontmatter does not pass through rehype, so write base directly
      link: /browserhive/quickstart/
      icon: right-arrow
      variant: primary
    - text: API reference
      link: /browserhive/api/
      icon: external
      variant: minimal
---

## What is BrowserHive

BrowserHive is an HTTP capture server built on Fastify + Puppeteer.
Calling `POST /v1/captures` enqueues the request and returns 202
immediately. Chromium workers fetch the page asynchronously and store the
results in S3-compatible storage.

## Features

- **Fire-and-forget**: requests are accepted immediately (202) and processed asynchronously
- **Capture coordinator**: multiple workers process capture tasks concurrently (work-stealing over a shared queue)
- **S3-compatible artifact storage**: every artifact is uploaded as `s3://<bucket>/[<keyPrefix>/]<filename>` (SeaweedFS, AWS S3, Cloudflare R2, …)
- **Link extraction**: optional `<a href>` extraction uploaded as `…links.json` — the discovery side of an external crawl driver
- **Stealth mode**: [puppeteer-extra-plugin-stealth](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth) to pass bot detection, including Cloudflare WAF
- **Banner / modal dismissal**: per-request flag that strips known cookie-consent banners and large fixed/sticky overlays before capturing (best-effort by default; strict mode via `failOnError: true`)
- **Per-task state isolation**: cookies / `localStorage` / DOM context wiped between tasks (configurable per-server and per-request)
- **OpenAPI 3.1 contract**: [`src/http/openapi.yaml`](https://github.com/uraitakahito/browserhive/blob/main/src/http/openapi.yaml) is the single source of truth — request/response types and runtime validation are both driven from it; see the [API reference](/api/)

## Capture formats

| Format | Flag | Use |
|--------|------|-----|
| PNG screenshot | `png` | Image of the page |
| WebP screenshot | `webp` | Lightweight image |
| DOM snapshot | `html` | HTML after JavaScript execution |
| Single-file archive | `mhtml` | MHTML with embedded resources |
| Replayable archive | `wacz` | WARC + indexes (replayable in ReplayWeb.page) |
| Link list | `links` | JSON of the links on the page |

## Learn more

- [Quickstart](/quickstart/) — from Apple Container startup to your first capture in 5 steps
- [Architecture](/architecture/) — XState state machines and the worker model in depth
- [API reference](/api/) — type definitions and usage for every parameter
