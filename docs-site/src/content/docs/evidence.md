---
title: Archives as evidence
description: What BrowserHive is working toward for evidentiary use, which properties hold today, and which do not yet
---

BrowserHive is working toward archives that can be offered as evidence — the
kind of capture someone has to stand behind later, not just replay.

This page says where that stands. It is a statement of direction and current
state, **not a claim that an archive produced today is admissible anywhere**.
Several properties that evidentiary use depends on are not implemented yet, and
they are listed as plainly as the ones that are.

:::caution
Nothing here is legal advice. Whether a particular archive can be used in a
particular proceeding is a question for a lawyer and, ultimately, for the court.
:::

## What authentication actually covers

The most common misunderstanding is worth stating first, because it decides
what is worth building.

The legal frameworks for electronic records authenticate **the record and the
person who made it** — not the origin of the content.

- Under the US Federal Rules of Evidence,
  [Rule 902(13) and 902(14)](https://www.law.cornell.edu/rules/fre/rule_902)
  allow electronic records to be self-authenticated by a **certification from a
  qualified person**. A hash value's role there is to show that what is offered
  is an identical copy of what was acquired — not where the original came from.
- In Japan, the presumption under
  [Article 3 of the Electronic Signature Act](https://laws.e-gov.go.jp/law/412AC0000000102)
  is that a record bearing the signer's own electronic signature was **created
  by the intent of its author** — that it was not forged by someone else. Whether
  its contents faithfully reflect an external website is a separate question.

So no amount of cryptography in the archive proves that a page really came from
a given server. What can be built instead is a **process that holds up to
scrutiny**: a record that is signed, timestamped, honest about its own gaps, and
reproducible by a third party.

That is the axis BrowserHive is working along.

## What holds today

| Property | How | Where |
| --- | --- | --- |
| The archive is signed | `signing: true` requests a [wacz-auth](https://specs.webrecorder.net/wacz-auth/0.1.0/) signature over the `sha256:` of `datapackage.json`, stored as `datapackage-digest.json` | [Signing a WACZ](/signing/) |
| A signing key is never held by the capture worker | BrowserHive sends the hash to a signing service and stores what comes back, so a compromised worker cannot forge a second archive | [Signing a WACZ](/signing/) |
| The signature is checked, not just received | Four checks before an archive may call itself signed: the signature covers the hash this capture produced, the certificate chains to a configured root, it was issued for the domain named, and the timestamp token covers this signature. Each is reported separately — `skipped` is not a pass | [Signing a WACZ](/signing/) |
| Signing fails closed | A capture that had to be signed and could not be is a failed capture; no artefact is stored. What is on offer is set per deployment by `--signing-policy` | [Signing a WACZ](/signing/) |
| The time of signing can be corroborated | `signedData` carries an RFC 3161 timestamp token when the signing service attaches one — the development service always does, and BrowserHive stores whatever comes back | [Signing a WACZ](/signing/) |
| The archive reports its own gaps | `completeness` records what the capture could **not** get — bodies lost to `304`, responses truncated at the size limit | [Capture results](/capture-results/) |
| The archive reports where it stopped | `coverage` records scroll exhaustion — how far down the page the capture actually reached before giving up | [Capture results](/capture-results/) |
| Settings are recorded as applied, not as requested | `settings` holds the viewport, cache mode, device pixel ratios and archive mode **that were in force**, so a reader can tell the conditions of the observation | [Capture results](/capture-results/) |
| The producing build is machine-readable | `build` carries version, revision and build time; `browser` carries the Chromium product string | [Capture results](/capture-results/) |
| An unsigned archive says why it is unsigned | `SignatureReport` distinguishes "nobody asked" from "we asked and it failed", and records the reason | [Signing a WACZ](/signing/) |
| The cryptography is reproducible by hand | The development signing service prints every `openssl` invocation it makes with `--explain`, so a third party can repeat each step without trusting the tool | [capping](https://uraitakahito.github.io/capping/) |
| Divergences from the specs are written down | Where BrowserHive does something other than what a spec suggests, the reason is published rather than discovered later | [Spec coverage](/spec-coverage/) |

The last several rows matter more than they look. An archive that volunteers
what it failed to capture is far easier to stand behind than one that is silent
and turns out to have gaps. That property is already the house style here, and
evidentiary use only makes it more important.

## What does not hold yet

These are the gaps. They are ordered by how much they matter for evidentiary
use, not by how hard they are.

### The development signing service is not usable for real signatures

The signing service used in development issues its own CA, and every file it
creates is prefixed `insecure-dev-`. The name is deliberate — it is meant to be
the first thing a reader notices — and it means exactly what it says.

**What is needed:** a signing certificate from a real certificate authority and
a recognised timestamp authority. `WaczSigner` is already a port, so the
substitution point exists; nothing about it has been exercised against a real
service.

### No operator identity is bound to the archive

The archive records which build produced it, but not **who** ran it. The
certification a court expects under FRE 902(13)/(14) is made by a person, and
there is currently nothing in the archive that ties one to the capture.

**What is needed:** a way to carry the requesting party's identity into the
archive, and to have the signature cover it.

### The TLS certificates presented by the origins are not recorded

BrowserHive can read the certificate chain each origin presented, through the
same browser that performed the capture, but does not currently store it.

A certificate does **not** prove the content came from that server — it is public
information, and anyone can attach a copy to anything. What it does support is
narrower and still worth having: the issuer reveals whether the connection was
intercepted, and the validity window can be checked against the claimed capture
time.

**What is needed:** storing the chain in the archive itself. Certificate
Transparency logs hold the same bytes, but an exhibit that depends on a
third-party service still being reachable years later is weaker for it — and
certificates issued by a private CA, which is precisely the interception case,
are not in those logs at all.

### Name resolution is not recorded

There is no record of which address actually answered for a host. DNS
substitution is harder to detect after the fact than certificate substitution,
so this is at least as important as the certificates.

**What is needed:** recording the resolved addresses alongside the TLS
observations.

### The stored archive is not protected against being replaced

Artifacts are uploaded to S3-compatible storage. The signature makes tampering
**detectable**, but nothing prevents an object from being overwritten or deleted,
and nothing records that it was.

**What is needed:** immutability on the storage side — object lock or equivalent
— and a documented retention policy. See [Storage](/storage/).

### There is no audit trail

Nothing records who requested a capture or who later retrieved it. Chain of
custody is part of what makes a process defensible, and it currently has to be
reconstructed from outside the system, if it can be reconstructed at all.

**What is needed:** an audit log covering request and retrieval.

## What BrowserHive will not claim

Overstating what an archive proves is a bigger risk than any of the gaps above.
A single overstated claim that collapses under examination takes the credible
claims down with it. These are the phrasings this project avoids, and what it
says instead.

| Not this | This |
| --- | --- |
| The certificate guarantees the content came from that server | The archive records the TLS information the browser observed at capture time |
| The archive is tamper-proof | The signature makes modification **detectable** |
| The archive is valid legal evidence | The archive records the information needed when offering it as evidence — admissibility is for the court |
| The page was captured completely | Anything the capture could not get is listed in `completeness` |

The same discipline applies to naming. Fields describing observed TLS are named
for the observation rather than for a guarantee, because a name like
`certificateProof` would start making a promise the implementation does not keep.

## Order of work

1. **Make signatures dependable.** Fail-closed signing and verification of
   what the signing service returns are implemented. What remains is a real
   certificate authority, a recognised timestamp authority, and an operator
   identity bound into the archive. Until those hold, later items add little.
2. **Record the capture context.** TLS certificate chains and resolved
   addresses, stored in the archive rather than referenced from it.
3. **Protect the archive after capture.** Storage immutability, retention, an
   audit trail, and a written verification procedure a third party can follow.

## See also

- [Signing a WACZ](/signing/) — how signing works today and how to verify it
- [Capture results](/capture-results/) — `completeness`, `coverage` and the rest of what an archive says about itself
- [Spec coverage](/spec-coverage/) — what BrowserHive implements of WARC, WACZ, CDXJ and wacz-auth, and what it does not
