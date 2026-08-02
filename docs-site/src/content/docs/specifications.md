---
title: Specifications
description: The standards behind what BrowserHive writes — which have Japanese translations, which do not, and which version each one corresponds to
---

Every file BrowserHive writes follows some standard. This page is where to look
when you want to know what a field is for.

**The ones with Japanese translations come first.** Those translations are
unofficial; the English originals are normative. Check the original when the
answer matters.

## With a Japanese translation

### WACZ 1.1.1

[日本語訳](https://uraitakahito.github.io/specs/wacz/1.1.1/) ·
[English original](https://specs.webrecorder.net/wacz/1.1.1/)

**This is the version BrowserHive writes** — `datapackage.json` carries
`wacz_version: "1.1.1"`. The `archive/`, `indexes/` and `pages/` layout inside
the ZIP, and the required fields of `datapackage.json`, are defined here.

### WACZ Signing and Verification 0.1.0

[日本語訳](https://uraitakahito.github.io/specs/wacz-auth/0.1.0/) ·
[English original](https://specs.webrecorder.net/wacz-auth/0.1.0/)

`datapackage-digest.json` and the shape of the `signedData` inside it. This is
the specification behind [Signing a WACZ](/signing/).

### Data Package (Frictionless Data)

[日本語訳](https://uraitakahito.github.io/datapackage/ja/) ·
[English original](https://datapackage.org/)

**WACZ is built on top of this.** The name `datapackage.json` and the fields
`profile`, `resources`, `path` and `hash` all come from here. It is what the
WACZ specification refers to as `[[FRICTIONLESS-DATA-PACKAGE]]`.

Pages worth bookmarking:

| | |
|---|---|
| [Data Package](https://uraitakahito.github.io/datapackage/ja/standard/data-package/) | The `datapackage.json` document itself — why BrowserHive writes `profile: "data-package"` |
| [Data Resource](https://uraitakahito.github.io/datapackage/ja/standard/data-resource/) | Each entry of `resources[]`: `path`, `name`, `hash`, `bytes` |
| [Table Schema](https://uraitakahito.github.io/datapackage/ja/standard/table-schema/) | Column definitions for tabular data. WACZ does not use it |
| [Glossary](https://uraitakahito.github.io/datapackage/ja/standard/glossary/) | The terms the standard defines |

## English only

These have no translation. The [specs fork](https://uraitakahito.github.io/specs/)
carries copies of the originals, but their contents are still English.

| Specification | What it covers |
|---|---|
| [WARC 1.1](https://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/) | What goes inside `archive/*.warc.gz`: record types, mandatory headers, what `WARC-Date` means |
| [WACZ 1.2.0](https://uraitakahito.github.io/specs/wacz/1.2.0/) | The next version. BrowserHive does not write it yet |
| [CDXJ 0.1.0](https://uraitakahito.github.io/specs/cdxj/0.1.0/) | The index format under `indexes/` |
| [WACZ use cases](https://uraitakahito.github.io/specs/use-cases/0.1.0/) | What WACZ was made for |
| [WACZ-IPFS](https://uraitakahito.github.io/specs/wacz-ipfs/latest/) | Distribution over IPFS. Outside BrowserHive's scope |
| [RFC 3161](https://www.rfc-editor.org/rfc/rfc3161) | Timestamping — what `signedData.timeSignature` holds |
| [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) | How BrowserHive drives Chromium |

## How much of it BrowserHive implements

For what BrowserHive does and does not write — rather than what the standards
say — see [Spec coverage](/spec-coverage/). It separates **not implemented**
from **deliberate divergence**.
