# Terminology

browserhive produces WACZ files. Comments and docs use the canonical terms
from the [WACZ 1.1.1 Terminology](https://specs.webrecorder.net/wacz/1.1.1/#terminology)
([日本語訳](https://uraitakahito.github.io/specs/wacz/1.1.1/#terminology)) as a
shared, ubiquitous language whenever they talk about WACZ output.

| Concept | Use | Avoid | Out of scope (other context / identifier) |
|---------|-----|-------|-------------------------------------------|
| ZIP container | `ZIP file` / `ZIP` | lowercase `zip` | `zip` variable, `zip.append`, the `application/wacz+zip` media type literal, `gzip`, `.zip` extension |
| Media type | `Media Type` | `MIME` (in WACZ-facing prose) | CDP `mimeType` field, HTTP `Content-Type` header, the `--wacz-skip-content-types` flag, the CDXJ literal field `mime` |
| Page | `Page` | `page` (WACZ pages.jsonl entry) | the live Playwright / browser `page` |
| Web Archive | `Web Archive` | bare `archive` (the whole web archive) | the `archive/` directory inside a WACZ |
| Package | `Package` | — | npm `package` |
| Context | `Context` | — | XState / browser / execution context |

## Rule

The repository spans two bounded contexts; pick the vocabulary that matches
what a comment is actually describing:

- **WACZ packaging** (the `src/storage/wacz/**` layer, `docs/wacz-internals.md`,
  the served output): use the WACZ Terminology term — `ZIP file`, `Media Type`,
  `Page`.
- **Capture / CDP / HTTP** (the `src/capture/**` layer): keep the source
  vocabulary it documents — Chromium DevTools Protocol `mimeType`, HTTP
  `Content-Type`, Playwright `page`. Forcing these into WACZ terms would make
  the prose disagree with the code it describes.

Code identifiers, string literals (e.g. the `application/wacz+zip` media type),
and CLI flag names are never rewritten — this is a documentation/comment rule.
