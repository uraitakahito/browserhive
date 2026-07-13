---
title: WACZ vocabulary
description: Vocabulary discipline (ubiquitous language) for writing about WACZ output
---

browserhive produces WACZ files. Comments and docs that talk about the WACZ
output use the canonical terms of the
[WACZ 1.1.1 Terminology](https://specs.webrecorder.net/wacz/1.1.1/#terminology)
([Japanese translation](https://uraitakahito.github.io/specs/wacz/1.1.1/#terminology))
as the shared, ubiquitous language.

This is distinct from the **component glossary** (the
[Terminology](/terminology/) page generated from `@glossary` tags) — it is a
**writing discipline**: which words to use and which to avoid.

| Concept | Use | Avoid | Out of scope (other context / identifiers) |
|---------|-----|-------|---------------------------------------------|
| ZIP container | `ZIP file` / `ZIP` | lowercase `zip` | the `zip` variable, `zip.append`, the media-type literal `application/wacz+zip`, `gzip`, the `.zip` extension |
| Media type | `Media Type` | `MIME` (in prose about WACZ) | CDP's `mimeType` field, HTTP's `Content-Type` header, the `--wacz-skip-content-types` flag, the CDXJ literal field `mime` |
| Page | `Page` | `page` (for WACZ pages.jsonl entries) | the live Playwright / browser `page` |
| Web archive | `Web Archive` | bare `archive` (for the archive as a whole) | the `archive/` directory inside a WACZ |
| Package | `Package` | — | an npm `package` |
| Context | `Context` | — | XState / browser / execution contexts |

## Rules

This repository spans two bounded contexts. Choose vocabulary based on what
a comment is **actually describing**:

- **WACZ packaging** (the `src/storage/wacz/**` layer, [WACZ internals](/wacz-internals/),
  the shipped output): use the WACZ Terminology terms — `ZIP file`,
  `Media Type`, `Page`.
- **Capture / CDP / HTTP** (the `src/capture/**` layer): keep the original
  vocabulary the code is describing — Chromium DevTools Protocol's
  `mimeType`, HTTP's `Content-Type`, Playwright's `page`. Forcing these into
  WACZ terms would make the prose disagree with the code it documents.

Never rewrite code identifiers, string literals (e.g. the
`application/wacz+zip` media type), or CLI flag names — this is a rule for
docs and comments only.
