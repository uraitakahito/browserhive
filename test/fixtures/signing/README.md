# Signing fixtures

A real `signedData` and the one root that does *not* verify it. Not
hand-written: every byte here was produced by
[capping](https://uraitakahito.github.io/capping/), because a placeholder
cannot be verified and a verifier tested against one proves nothing.

The trust anchors are not here. They are `../dev-ca/insecure-dev-ca.crt` and
`../dev-ca/insecure-dev-tsa-ca.crt` — the identity the dev stack's capping
signs with, already committed and already mounted by `docker-compose.yml`.
Signing these fixtures with the same identity means there is one dev CA in the
repository rather than two, and that what the tests verify is what the running
stack produces.

The timestamps come from sigstore's authority now rather than from capping,
which since v0.5.0 issues none of its own. `timestampCert` did not change —
the TSA signs with the same `insecure-dev-tsa` identity, so both anchors above
stayed exactly where they were. What changed is inside the token: serials that
differ per request, where the stand-in reused `0x02`.

| File | What it is |
| --- | --- |
| `signed-data.json` | wacz-auth `signedData` over `HASH` below, signed by the dev CA. The happy path. |
| `other-ca.pem` | An unrelated root. Nothing here chains to it — that is its job. |
| `other-time-signature.txt` | A genuine timestamp token, issued over a *different* signature. |
| `expired-tsa-ca.crt` | A timestamp root whose validity window has closed. |
| `expired-time-signature.txt` | A token issued by that authority *while it was still valid*. |

The hash the signature covers:

```
sha256:0be7b2fea93622c434c8f205494e2d0b451acae3803dc87420b6ef51e151239c
```

`other-time-signature.txt` exists because the obvious way to test the timestamp
check does not work. Mutating the signature defeats the *signature* check first
and never reaches the timestamp; dropping `timeSignature` reports `skipped`,
not `failed`. What is left is a token that is valid in itself and belongs to
other bytes — which is also what swapping tokens between archives would look
like. Corrupting the token would fail for being corrupt, and prove less.

`expired-time-signature.txt` is the case that cannot be reached by mutating
anything, because what it tests is the passage of time. Its authority was
issued a certificate valid for a few minutes, signed this token inside that
window, and has been expired ever since. Verified as of *now* it fails;
verified as of the moment it claims, it passes — which is the whole difference
between an archive that stays checkable and one that stops in 2036, when the
dev CA lapses.

Every other case is a mutation of these: a different hash, a rewritten
`domain`, a missing `timeSignature`. Only the cases that need their own key
material are stored.

## Regenerating

The dev CA is valid for ten years, so this should not be needed. If it is,
bring the signing profile up and ask the running stack — the point of these
fixtures is that they are what it produces:

```bash
pnpm run stack:up
H=sha256:0be7b2fea93622c434c8f205494e2d0b451acae3803dc87420b6ef51e151239c
curl -sS -X POST http://capping.browserhive:8080/sign \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer dev-token' \
  -d "{\"hash\":\"$H\"}"
```

That whole response is `signed-data.json`. For `other-time-signature.txt`, ask
for any other hash and keep its `timeSignature`. `other-ca.pem` is the
`insecure-dev-ca.crt` of a separate `capping init` with any domain.

The CLI works too, but needs `--tsa-url` — capping issues no timestamps of its
own since v0.5.0, and without one the signature comes out with no
`timeSignature` at all:

```bash
capping sign --dir test/fixtures/dev-ca --hash "$H" --explain \
  --tsa-url http://tsa.browserhive:3004/api/v1/timestamp
```

### The expired pair

`expired-tsa-ca.crt` and `expired-time-signature.txt` are the awkward ones,
because a certificate cannot be made to have expired in the past while also
having signed something during its validity. The recipe is to give it a window
that closes shortly, sign inside it, and let the clock do the rest:

```bash
NB=$(date -u +%Y%m%d000000Z)
NA=$(date -u -v+120S +%Y%m%d%H%M%SZ)          # two minutes from now
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt \
  -subj "/CN=insecure-expired-dev-tsa-ca" -not_before "$NB" -not_after "$NA"
# …issue a leaf with extendedKeyUsage=critical,timeStamping over the same
# window, then `openssl ts -reply` over the *current* signed-data.json
# `signature` field, exactly as written, with no trailing newline.
```

The token has to cover the signature that is in `signed-data.json` at the time,
so regenerating that file means regenerating this pair as well. By the time any
test runs, the two minutes are long gone — which is the state being tested.

`--explain` prints the `openssl` invocations it made, so what is in these files
can be reproduced by hand rather than taken on trust.

## These are not secrets

The dev CA's private keys are in `../dev-ca/` and say `insecure-dev-` in every
filename capping generates for a reason. That CA reaches no trust store, and
nothing signed by it is trusted anywhere.
