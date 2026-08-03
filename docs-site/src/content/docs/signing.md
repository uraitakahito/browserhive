---
title: Signing a WACZ
description: Requesting a wacz-auth signature per capture, reading the outcome, and verifying it
---

`signing: true` requires a
[wacz-auth](https://specs.webrecorder.net/wacz-auth/0.1.0/) signature: the
configured service is asked for one, the answer is **verified**, and the result
is stored as `datapackage-digest.json` inside the WACZ. A capture that cannot
be signed fails, and no artefact is stored.

BrowserHive never holds a signing key. It sends the `sha256:` of
`datapackage.json` and stores what comes back, so a compromised capture worker
is not in a position to forge a second archive. In development that service is
[capping](https://uraitakahito.github.io/capping/), started by the `signing`
compose profile.

```bash title="The signing service has to be running"
container-compose --profile signing up -d -b
```

Leave the profile off and captures that do not ask for a signature still work.
Ones that do ask now **fail**, naming the service they could not reach — see
[A signature that cannot be obtained is a failed
capture](#a-signature-that-cannot-be-obtained-is-a-failed-capture).

## Requesting a signed capture

```bash title="POST /v1/captures"
curl -sS --fail-with-body -X POST http://localhost:8080/v1/captures \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "captureFormats": {
      "png":   false,
      "webp":  false,
      "html":  false,
      "mhtml": false,
      "wacz":  true,
      "links": false
    },
    "signing": true
  }' | jq .
```

```json
{
  "accepted": true,
  "taskId": "550e8400-e29b-41d4-a716-446655440000"
}
```

`signing` requires `captureFormats.wacz: true`. Asking to sign a capture that
produces no WACZ is rejected with **400** — there is nowhere to put the
signature, and accepting the request would leave you believing you had asked
for something:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8080/v1/captures \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","captureFormats":{"png":true,"webp":false,"html":false,"mhtml":false,"wacz":false,"links":false},"signing":true}'
# → 400
```

## Reading the outcome

```bash title="GET /v1/captures/{taskId}"
curl -sS http://localhost:8080/v1/captures/550e8400-e29b-41d4-a716-446655440000 \
  | jq '{status, wacz: .artifacts.wacz, signature}'
```

```json
{
  "status": "success",
  "wacz": "s3://browserhive/550e8400-….wacz",
  "signature": { "signed": true, "domain": "sign.dev.local" }
}
```

```json
{
  "status": "success",
  "wacz": "s3://browserhive/550e8400-….wacz",
  "signature": {
    "signed": true,
    "domain": "sign.dev.local",
    "checks": { "signature": "ok", "chain": "ok", "domain": "ok", "timestamp": "ok" }
  }
}
```

`signature` is absent when the capture did not need one — which is a different
answer from `signed: false`, and the reason the field is optional rather than
always present.

### `checks` says how far the verification went

`signed: true` means the signature was checked, not merely received. `checks`
says which checks ran:

| Check | What it establishes | Needs |
|---|---|---|
| `signature` | The signature covers the `datapackage.json` **this capture produced** — not the hash the response echoed back. | — |
| `chain` | The certificate reaches a root this server was configured to trust. | `BROWSERHIVE_SIGNING_TRUST_ANCHOR` |
| `domain` | The certificate was issued for the domain the response names. | — |
| `timestamp` | The timestamp token covers **this** signature. | `BROWSERHIVE_SIGNING_TIMESTAMP_ANCHOR` |

Each is `ok`, `failed`, or `skipped`. **`skipped` is not a pass.** The chain and
timestamp checks each need a trust anchor to check against, and a server with
neither configured still runs the other two — those need no configuration, and
they are what catch a service signing the wrong bytes.

A `failed` check never reaches you as a result: it fails the capture. `checks`
on a successful capture therefore holds only `ok` and `skipped`, and reading it
tells you what your configuration actually verified.

The `timestamp` check is made **as of the moment the token says it was issued**,
not as of now. A timestamping certificate expiring is the authority declining to
sign anything new; it says nothing about what that authority signed while the
certificate was valid, and an archive is exactly the thing that gets read
afterwards. Verifying at the current time instead would fail every archive in
storage the day the certificate lapsed, without a byte of any of them having
changed. What this does not establish is that the asserted time is *true* — see
[Evidence](/evidence/#the-timestamp-is-checked-against-the-time-it-asserts).

### <span id="a-signature-that-cannot-be-obtained-is-a-failed-capture">A signature that cannot be obtained is a failed capture</span>

If the service is down, slow, refuses the token, or returns something that does
not verify, **the capture fails and nothing is stored**:

```json
{
  "status": "failed",
  "errorDetails": {
    "type": "signing",
    "message": "a signature was required and could not be obtained: http://capping.browserhive:8080/sign — fetch failed: getaddrinfo ENOTFOUND capping.browserhive"
  }
}
```

No WACZ is uploaded — the archive is not written at all, so there is no
half-signed artefact to find later. `errorDetails.type` is `signing` rather
than `internal` because the two want different responses: a signing service
that is down is restarted and the capture retried, while `internal` is where
bugs live.

This used to be the opposite. A failed signature left a successful capture and
an uploaded WACZ, with the outcome in a field nobody had to read — so a wrong
URL, a wrong token or a service nobody started all produced archives that
looked fine and were not signed. Nothing went red.

:::note[Unsigned capture is unchanged]
Omit `signing`, or set it to `false`, and the capture succeeds exactly as it
did before — signing service or no signing service. What fails is asking for a
signature and not getting one. There is no "sign if you can": an archive whose
value depends on whether a service happened to be up is one nobody can rely on
without checking.
:::

### The server decides what is on offer

`--signing-policy` sets what this deployment does about signatures, and the
request chooses within it:

| Policy | `signing` omitted | `signing: true` | `signing: false` |
|---|---|---|---|
| `forbidden` | no signature | **400** | no signature |
| `optional` *(default)* | no signature | signature required | no signature |
| `required` | **signature required** | signature required | **400** |

`required` exists so an evidence deployment does not depend on every caller
remembering a flag — forgetting it is the same quiet failure as a signature
that could not be obtained, one level up. `forbidden` is its mirror: a server
with no signing service cannot be made to fail a capture over one.

A server started with `--signing-policy required` **refuses to start** without
both `--signing-url` and `--signing-trust-anchor`. Without the URL every
capture would fail, one at a time, for a reason visible only in a worker log.
Without the anchor the chain check is `skipped` — so a required signature would
be a signature from **any** CA, the development one included, which is the
opposite of why a deployment picks `required`.

## Verifying the signature

Download the archive and pull the digest out of it:

```bash
AWS_ACCESS_KEY_ID=browserhive AWS_SECRET_ACCESS_KEY=browserhive \
aws --endpoint-url "http://seaweedfs.browserhive:8333" \
  s3 cp s3://browserhive/550e8400-….wacz ./capture.wacz

unzip -p capture.wacz datapackage-digest.json > datapackage-digest.json
```

BrowserHive already ran these four checks before storing the archive, so this
is a second opinion rather than the first — useful for confirming an archive
that has travelled, or for checking one produced by something else:

```console
$ node capping/dist/cli.js verify \
    --file datapackage-digest.json \
    --root test/fixtures/dev-ca/insecure-dev-ca.crt
  ok       signature  signature matches the hash under the certificate's key
  ok       chain      chain reaches a supplied trust root
  ok       domain     certificate is valid for sign.dev.local
  ok       timestamp  timestamp covers this signature

valid
```

`--root` is the development CA committed at
`test/fixtures/dev-ca/insecure-dev-ca.crt`. It is the same in every checkout on
purpose: a fixed trust anchor is what lets a test assert `valid` rather than
merely "a digest file appeared". Those keys sign nothing anyone trusts — the CA
reaches no trust store, which is also what a production server configured with
a real anchor relies on to reject them.

Add `--explain` to see the openssl commands behind each stage.

:::caution[waxlens does not verify the signature]
waxlens checks that `datapackage-digest.json` exists and that its `hash`
matches `datapackage.json`. It does **not** check the signature, the
certificate chain, the domain, or the timestamp. A tampered `signedData` passes
waxlens and fails `capping verify`.
:::

## Configuration

| Variable | Meaning |
|---|---|
| Variable | Meaning |
|---|---|
| `BROWSERHIVE_SIGNING_POLICY` | `forbidden` / `optional` (default) / `required`. What this deployment offers. `required` without a URL refuses to start. |
| `BROWSERHIVE_SIGNING_URL` | The service's `/sign` endpoint. Unset means no signing service: a capture that needs one fails, naming the server rather than blaming the request. |
| `BROWSERHIVE_SIGNING_TOKEN` | Bearer token, when the service wants one. |
| `BROWSERHIVE_SIGNING_TIMEOUT_MS` | How long to wait for a signature. Default 5000. |
| `BROWSERHIVE_SIGNING_TRUST_ANCHOR` | PEM holding the root that issued the signing certificate. Unset leaves the chain check `skipped`, which accepts a signature from **any** CA. Required under `signingPolicy: required`. |
| `BROWSERHIVE_SIGNING_TIMESTAMP_ANCHOR` | PEM holding the root that issued the timestamp authority. Unset leaves the timestamp check `skipped`. |

Every one has a CLI flag of the same name (`--signing-policy`, …).

The dev stack sets all but the policy in `docker-compose.yml`, with both
anchors pointing at the identity capping signs with — so development exercises
all four checks rather than two. capping only starts under `--profile signing`.

:::caution[The anchors are what reject the development CA]
A production server that sets `BROWSERHIVE_SIGNING_TRUST_ANCHOR` to a real root
rejects anything the `insecure-dev-` CA signed: the chain check fails, and with
a signature required that fails the capture. Leave the anchor unset and the
check is `skipped` — the archive says so, but nothing stops a development
signature from ending up in a production archive.
:::

## What is in the archive

```json title="datapackage-digest.json, at the WACZ root"
{
  "path": "datapackage.json",
  "hash": "sha256:0be7b2fea93622c434c8f205494e2d0b451acae3803dc87420b6ef51e151239c",
  "signedData": {
    "hash": "sha256:0be7b2fe…",
    "created": "2026-08-02T00:00:00.000Z",
    "software": "capping/0.3.0",
    "signature": "MEQCIGS0Ydsd…",
    "domain": "sign.dev.local",
    "domainCert": "-----BEGIN CERTIFICATE-----\n…",
    "timeSignature": "MIIJHTADAgEAMIIJFAYJ…",
    "timestampCert": "-----BEGIN CERTIFICATE-----\n…"
  }
}
```

`hash` covers `datapackage.json`, which in turn covers every other file in the
archive — so one signature reaches the whole WACZ.

BrowserHive implements the spec's **Domain-Ownership Identity + Signed
Timestamp** format. The Anonymous Signature format is not implemented; see
[Spec coverage](/spec-coverage/).

## See also

- [Replay quickstart](/replay-quickstart/) — recording and replaying a WACZ
- [Spec coverage](/spec-coverage/) — what of WACZ / WARC / wacz-auth is used
- wacz-auth spec: <https://specs.webrecorder.net/wacz-auth/0.1.0/>
- capping: <https://uraitakahito.github.io/capping/>
