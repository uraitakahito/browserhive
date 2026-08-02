# Signing fixtures

A real `signedData` and the roots that verify it. Not hand-written: every byte
here was produced by [capping](https://uraitakahito.github.io/capping/), because
a placeholder cannot be verified and a verifier tested against one proves
nothing.

| File | What it is |
| --- | --- |
| `signed-data.json` | wacz-auth `signedData` over `HASH` below. The happy path. |
| `ca.pem` | The root that issued the signing certificate. Trust anchor for the chain check. |
| `tsa-ca.pem` | The root that issued the timestamp authority. Trust anchor for the timestamp check. |
| `other-ca.pem` | An unrelated root. Nothing here chains to it — that is its job. |

The hash the signature covers:

```
sha256:0be7b2fea93622c434c8f205494e2d0b451acae3803dc87420b6ef51e151239c
```

Every other case the tests need is a mutation of these — a different hash, a
tampered `domain`, a missing `timeSignature` — so only the cases that need
their own key material are stored.

## Regenerating

The certificates are valid for ten years, so this should not be needed. If it
is:

```bash
D=$(mktemp -d)
capping init --dir "$D" --domain sign.dev.local
capping sign --dir "$D" \
  --hash sha256:0be7b2fea93622c434c8f205494e2d0b451acae3803dc87420b6ef51e151239c \
  --explain > "$D/digest.json"
```

`signed-data.json` is the `signedData` member of that output; `ca.pem` and
`tsa-ca.pem` are `insecure-dev-ca.crt` and `insecure-dev-tsa-ca.crt`.
`other-ca.pem` is the `insecure-dev-ca.crt` of a second `capping init` with any
other domain.

`--explain` prints the `openssl` invocations it made, so what is in these files
can be reproduced by hand rather than taken on trust.

## These are not secrets

The private keys are not here, and the certificates say `insecure-dev-` in
every filename capping generates for a reason. Nothing in this directory is
usable for signing anything.
