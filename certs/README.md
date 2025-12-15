# About the certs Directory

This directory contains sample certificates for development and testing purposes.

## For Production Use

**Delete all files in this directory and create new certificates.**

```bash
rm -f certs/*.crt certs/*.key
```

See [docs/tls-certificates.md](../docs/tls-certificates.md) for certificate creation instructions.

## Reason

- The private keys for sample certificates are published in the repository and are not secure
- Production environments require unique certificates
