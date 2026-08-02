---
title: Spec coverage
description: Which parts of WARC, WACZ, CDXJ and wacz-auth BrowserHive implements — and which it does not, with the reason
---

BrowserHive writes to four specifications. This page says what it emits of each
one, what it leaves out, and where it knowingly does something else.

The distinction that matters is between **not used** and **divergent**. Leaving a
field out is a scope decision; taking a different route where the spec offers one
is a trade-off someone made, and the reason belongs in writing.

:::note
Generated from `test/docs/spec-coverage-data.ts`. Editing this file directly will
be overwritten — and CI checks that the table still matches the code.
:::

## Summary

| Surface | Covered |
| --- | --- |
| WACZ file layout | 5 / 7 |
| WARC record types | 4 / 8 |
| WARC header fields | 13 / 21 |
| CDXJ index | 7 / 8 |
| pages.jsonl | 4 / 6 |
| datapackage.json | 7 / 10 |
| Signing (wacz-auth) | 1 / 2 |

"Covered" counts implemented and implemented-plus. Non-spec extensions are
listed but excluded from the denominator.

## WACZ file layout

Defined by: WACZ 1.1.1 — WACZ Object

| Item | State | Notes |
| --- | --- | --- |
| `archive/data.warc.gz` | Implemented | One gzipped WARC per capture. |
| `indexes/index.cdxj` | Implemented | Plain CDXJ, one line per response record. |
| `indexes/index.idx (ZipNum)` | Divergent | The spec allows a gzipped, clustered index. wabac.js cannot read it, and replay is the point of producing a WACZ at all. |
| `pages/pages.jsonl` | Implemented | Header line plus one entry — a capture is one page. |
| `pages/extraPages.jsonl` | Not used | For crawl-discovered pages. A capture has exactly one page, so there is nothing to put here. |
| `datapackage.json` | Implemented | Frictionless data package manifest with a hash per resource. |
| `datapackage-digest.json` | Implemented | Written when a capture asks to be signed (`signing: true`). Carries the `sha256:` of datapackage.json plus the wacz-auth signedData returned by the signing service. |
| `fuzzy.json (non-spec)` | Divergent | Not in the spec. The spec permits extra files at the root, and wabac.js reads this one for fuzzy URL matching on replay. |

## WARC record types

Defined by: WARC 1.1 (ISO 28500) §5

| Item | State | Notes |
| --- | --- | --- |
| `warcinfo` | Implemented | One per WARC, carrying software / format / conformsTo. |
| `request` | Implemented | Paired with its response through WARC-Concurrent-To. |
| `response` | Implemented | Status line, headers and body as an HTTP/1.1 message. |
| `metadata` | Implemented | Records why a body is missing, so a dropped URL is never silently absent. |
| `resource` | Not used | For content not fetched over HTTP — DNS lookups are the usual case. Chromium's DevTools Protocol does not expose the resolver's answers. |
| `revisit` | Not used | For a payload already stored elsewhere. Each capture writes its own WARC and never dedupes across them. |
| `conversion` | Not used | For a re-encoded copy of another record. Nothing is transformed after capture. |
| `continuation` | Not used | For a record split across files. Everything for one capture goes in one WARC. |

## WARC header fields

Defined by: WARC 1.1 (ISO 28500) §5

| Item | State | Notes |
| --- | --- | --- |
| `WARC-Record-ID` | Implemented | urn:uuid, allocated before the response arrives so request and response can point at each other. |
| `WARC-Type` | Implemented | One of the four types above. |
| `WARC-Date` | Implemented | Millisecond precision, which WARC 1.1 permits. Note this is when the record was written, not when the exchange happened. |
| `WARC-Target-URI` | Implemented | The URL the record is about. |
| `Content-Type` | Implemented | application/http;msgtype=… or application/warc-fields. |
| `Content-Length` | Implemented | Byte length of the record block as stored. |
| `WARC-Block-Digest` | Implemented | sha256, base32, over the whole block. |
| `WARC-Payload-Digest` | Implemented | sha256, base32, over the body — including the empty body of a response whose payload was dropped. |
| `WARC-Concurrent-To` | Implemented | Links request, response and metadata from one capture event. |
| `WARC-IP-Address` | Implemented | The address actually contacted. Stronger evidence than a name lookup: it survives DNS changes and CDN switches. |
| `WARC-Filename` | Implemented | On the warcinfo record. |
| `WARC-Refers-To` | Implemented | Points a metadata record at the response it explains. |
| `WARC-Truncated` | Implemented + supplemented | `length` when a size cap dropped a body. Supplemented by a metadata record: the field's four enumerated values cannot say how large the body was, or which cap fired. |
| `WARC-Warcinfo-ID` | Not used | Links a record back to its warcinfo. There is exactly one warcinfo per file, so the link carries no information. |
| `WARC-Profile` | Not used | Only meaningful on revisit records, which are unused. |
| `WARC-Identified-Payload-Type` | Not used | The writer's own sniffed type, as opposed to the declared one. Nothing sniffs. |
| `WARC-Refers-To-Target-URI` | Not used | Revisit-only. |
| `WARC-Refers-To-Date` | Not used | Revisit-only. |
| `WARC-Segment-Number` | Not used | Segmentation is unused — one capture, one file. |
| `WARC-Segment-Origin-ID` | Not used | Segmentation is unused. |
| `WARC-Segment-Total-Length` | Not used | Segmentation is unused. |

## CDXJ index

Defined by: CDXJ 0.1.0

| Item | State | Notes |
| --- | --- | --- |
| `url` | Implemented | Required. |
| `digest` | Implemented | Required. Present on every line, including responses that stored no body — zero bytes hash to a defined value. |
| `mime` | Implemented | Required. |
| `filename` | Implemented | Required. Relative to archive/, as pywb and wacz-creator write it. |
| `offset` | Implemented | Required. Emitted as a string, per the reference producers. |
| `length` | Implemented | Required. Emitted as a string. |
| `status` | Implemented | Required. Emitted as a string. |
| `recordDigest` | Not used | Appears in the spec's example but not in its list of required properties. Nothing reads it. |

## pages.jsonl

Defined by: WACZ 1.1.1 — pages.jsonl

| Item | State | Notes |
| --- | --- | --- |
| `url (MUST)` | Implemented | The captured page. |
| `ts (MUST)` | Implemented | Replay pins its clock shims to this, so JS that bakes Date.now() into a URL re-emits the same URL. |
| `title (MAY)` | Implemented | The page's <title>. |
| `id (MAY)` | Implemented | The BrowserHive task id, so logs cross-reference. |
| `text (MAY)` | Not used | Extracted page text, for full-text search over an archive. Nothing here searches. |
| `size (MAY)` | Not used | Total bytes of the page and its resources. Already reported per capture in waczStats. |

## datapackage.json

Defined by: WACZ 1.1.1 — datapackage.json

| Item | State | Notes |
| --- | --- | --- |
| `profile (MUST)` | Implemented | The literal "data-package". |
| `resources (MUST)` | Implemented | name / path / hash / bytes for every file in the package. |
| `wacz_version (MUST)` | Implemented | "1.1.1". |
| `title (SHOULD)` | Implemented | The page title, falling back to its URL. |
| `created (SHOULD)` | Implemented | When the WACZ was assembled. |
| `software (SHOULD)` | Implemented | browserhive plus the released version. |
| `mainPageDate (SHOULD)` | Implemented | When the page was captured. |
| `mainPageUrl (SHOULD)` | Divergent | Written as `mainPageURL`. wabac.js reads that spelling; the spec's is `mainPageUrl`, and 1.2.0 drops the property entirely. Replay wins here. |
| `description (SHOULD)` | Not used | A longer prose description. A capture has no editorial description to give. |
| `modified (SHOULD)` | Not used | A WACZ is written once and never edited, so it equals `created`. |
| `browserhive:capture (non-spec)` | Divergent | Not in the spec. What this capture could not get: `completeness` (bodies lost to a 304 or a size cap) and `coverage` (whether scrolling stopped at its step cap rather than the end of the page). Namespaced because it is an observation, not agreed vocabulary. The Frictionless schema has no `additionalProperties: false`, and wabac.js reads only config / profile / metadata / resources from this file. |

## Signing (wacz-auth)

Defined by: WACZ Signing and Verification 0.1.0

| Item | State | Notes |
| --- | --- | --- |
| `Anonymous Signature` | Not used | Signs the digest with a bare key pair. Verification then needs the public key distributed some other way. |
| `Domain-Ownership Identity + Signed Timestamp` | Implemented | Requested per capture via `signing: true` and produced by an external signing service (capping in development). BrowserHive sends the hash and stores what comes back; it never holds a signing key. |

## Deliberately out of scope

Things a capture never tries to hold, as opposed to fields it does not emit:

- **Authentication flows, live data, WebRTC** — see [Replay quickstart](/replay-quickstart/).
- **The captured page's own service worker** — replay installs its own, and the
  captured one fights it.
- **Bodies over `maxResponseBytes`** — recorded as a truncation, and the capture
  reports itself incomplete.
- **Traffic matching the default block list** (`google-analytics.com` and friends)
  — nothing is recorded at all.

## Related

- [WACZ internals](/wacz-internals/) — how the encoding works, and the replay
  gotchas found by debugging it.
- [WACZ vocabulary](/wacz-vocabulary/) — which words to use when writing about
  this output.
