---
title: Signing a WACZ
description: Requesting a wacz-auth signature per capture, reading the outcome, and verifying it
---

`signing: true` asks the configured signing service for a
[wacz-auth](https://specs.webrecorder.net/wacz-auth/0.1.0/) signature and
stores it as `datapackage-digest.json` inside the WACZ.

BrowserHive never holds a signing key. It sends the `sha256:` of
`datapackage.json` and stores what comes back, so a compromised capture worker
is not in a position to forge a second archive. In development that service is
[capping](https://uraitakahito.github.io/capping/), started by the `signing`
compose profile.

```bash title="The signing service has to be running"
container-compose --profile signing up -d -b
```

Leave the profile off and everything still works — but every signed capture
comes back `signature.signed: false`. See [Nothing looks wrong when it is
broken](#nothing-looks-wrong-when-it-is-broken).

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

`signature` has **three** states, and they are three different answers:

| `signature` | Meaning |
|---|---|
| absent | The capture did not ask to be signed. |
| `{ "signed": true, "domain": … }` | Signed by that domain's certificate. |
| `{ "signed": false, "reason": … }` | It asked, and did not get one. `reason` says why. |

### A failed signature is not a failed capture

If the service is down, slow, or refuses the token, **the WACZ is still
written** and the capture still succeeds:

```json
{
  "status": "success",
  "wacz": "s3://browserhive/550e8400-….wacz",
  "signature": {
    "signed": false,
    "reason": "http://capping.browserhive:8080/sign — fetch failed: getaddrinfo ENOTFOUND capping.browserhive"
  }
}
```

This is deliberate. An archive is worth keeping whether or not anyone
countersigned it, and a signing service having a bad day should not cost you
the capture. The `reason` names the endpoint and the underlying cause so the
line is a diagnosis rather than a shrug — `ENOTFOUND` above says the container
is not running.

### <span id="nothing-looks-wrong-when-it-is-broken">Nothing looks wrong when it is broken</span>

That policy has a cost worth stating plainly. A wrong URL, a wrong token, a
service nobody started — all of them produce **a successful capture and an
uploaded WACZ**. Nothing goes red.

So `signature.signed` is not decoration. It is the only thing that
distinguishes a signed archive from an unsigned one, and checking it is the
whole discipline:

```bash title="Fail a script when a capture came back unsigned"
curl -sS "http://localhost:8080/v1/captures/$TASK_ID" \
  | jq -e '.signature.signed == true' > /dev/null \
  || echo "unsigned — check: container logs capping.browserhive"
```

## Verifying the signature

Download the archive and pull the digest out of it:

```bash
AWS_ACCESS_KEY_ID=browserhive AWS_SECRET_ACCESS_KEY=browserhive \
aws --endpoint-url "http://seaweedfs.browserhive:8333" \
  s3 cp s3://browserhive/550e8400-….wacz ./capture.wacz

unzip -p capture.wacz datapackage-digest.json > datapackage-digest.json
```

`capping verify` is the only thing that checks the signature itself:

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

`--root` is the development CA committed at `test/fixtures/dev-ca/insecure-dev-ca.crt`. It
is the same in every checkout on purpose: a fixed trust anchor is what lets a
test assert `valid` rather than merely "a digest file appeared". Those keys
sign nothing anyone trusts — the CA reaches no trust store.

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
| `BROWSERHIVE_SIGNING_URL` | The service's `/sign` endpoint. Unset means no signing service: a capture that asks is reported `signed: false`. |
| `BROWSERHIVE_SIGNING_TOKEN` | Bearer token, when the service wants one. |
| `BROWSERHIVE_SIGNING_TIMEOUT_MS` | How long to wait before going out unsigned. Default 5000. A signature is optional, so this is the most one can cost a capture. |

The dev stack sets the first two in `docker-compose.yml`; capping only starts
under `--profile signing`.

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
