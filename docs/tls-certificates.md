# TLS Certificate Creation Guide

This guide explains how to create the certificates required to enable TLS in BrowserHive.

## Overview

The following files are required for TLS (server authentication):

| File | Purpose | Used by |
|------|---------|---------|
| `ca.crt` | CA certificate | Client (for server verification) |
| `server.crt` | Server certificate | Server |
| `server.key` | Server private key | Server |

## Certificate Creation Steps

### Prerequisites

OpenSSL must be installed:

```bash
openssl version
```

### Step 1: Create Working Directory

```bash
mkdir -p certs
cd certs
```

### Step 2: Create CA (Certificate Authority)

```bash
# Generate CA private key (4096 bits)
openssl genrsa -out ca.key 4096

# Generate CA certificate (valid for 365 days)
openssl req -new -x509 -days 365 -key ca.key -out ca.crt -subj "/CN=BrowserHive CA/O=BrowserHive/C=JP"
```

### Step 3: Create Server Certificate

```bash
# Generate server private key
openssl genrsa -out server.key 4096

# Create Certificate Signing Request (CSR)
openssl req -new -key server.key -out server.csr -subj "/CN=localhost/O=BrowserHive/C=JP"
```

### Step 4: Create SAN (Subject Alternative Name) Configuration File

The server certificate must include the hostnames or IP addresses that clients will use to connect:

```bash
cat > server-ext.cnf << EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
EOF
```

#### Additional Examples for Docker Environment

When using Docker Compose or container-to-container communication, add service names or container names:

```
[alt_names]
DNS.1 = localhost
DNS.2 = browserhive          # Docker Compose service name
DNS.3 = browserhive-server   # Custom hostname
IP.1 = 127.0.0.1
```

### Step 5: Sign Server Certificate

```bash
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 365 -extfile server-ext.cnf
```

### Step 6: Clean Up Intermediate Files

```bash
rm -f server.csr ca.srl server-ext.cnf
```

### Final File Structure

```
certs/
├── ca.crt      # Distribute to clients
├── ca.key      # Store securely (used for certificate renewal)
├── server.crt  # Used by server
└── server.key  # Used by server (store securely)
```

## Certificate Verification

### View CA Certificate Contents

```bash
openssl x509 -in certs/ca.crt -text -noout
```

### View Server Certificate Contents

```bash
openssl x509 -in certs/server.crt -text -noout
```

### Verify SAN

```bash
openssl x509 -in certs/server.crt -text -noout | grep -A1 "Subject Alternative Name"
```

### Verify Certificate Chain

```bash
openssl verify -CAfile certs/ca.crt certs/server.crt
```

## Connecting with grpcurl

To connect to a TLS-enabled server with grpcurl:

```bash
grpcurl -cacert ./certs/ca.crt localhost:50051 browserhive.v1.CaptureService/GetStatus
```

## Security Notes

1. **Protect Private Keys**: Store `ca.key` and `server.key` securely and restrict access permissions
   ```bash
   chmod 600 certs/*.key
   ```

2. **Certificate Expiration**: This guide sets a 365-day validity period. In production environments, set an appropriate expiration period and renew before expiration

3. **Production Environment Recommendations**:
   - Consider obtaining certificates from a trusted Certificate Authority (Let's Encrypt, commercial CAs, etc.)
   - Limit self-signed certificates to development and testing environments
