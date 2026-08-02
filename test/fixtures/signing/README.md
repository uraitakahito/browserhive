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

| File | What it is |
| --- | --- |
| `signed-data.json` | wacz-auth `signedData` over `HASH` below, signed by the dev CA. The happy path. |
| `other-ca.pem` | An unrelated root. Nothing here chains to it — that is its job. |
| `other-time-signature.txt` | A genuine timestamp token, issued over a *different* signature. |

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

Every other case is a mutation of these: a different hash, a rewritten
`domain`, a missing `timeSignature`. Only the cases that need their own key
material are stored.

## Regenerating

The dev CA is valid for ten years, so this should not be needed. If it is:

```bash
H=sha256:0be7b2fea93622c434c8f205494e2d0b451acae3803dc87420b6ef51e151239c
capping sign --dir test/fixtures/dev-ca --hash "$H" --explain
```

`signed-data.json` is the `signedData` member of that output. For
`other-time-signature.txt`, sign any other hash with the same `--dir` and keep
its `timeSignature`. `other-ca.pem` is the `insecure-dev-ca.crt` of a separate
`capping init` with any domain.

`--explain` prints the `openssl` invocations it made, so what is in these files
can be reproduced by hand rather than taken on trust.

## These are not secrets

The dev CA's private keys are in `../dev-ca/` and say `insecure-dev-` in every
filename capping generates for a reason. That CA reaches no trust store, and
nothing signed by it is trusted anywhere.
