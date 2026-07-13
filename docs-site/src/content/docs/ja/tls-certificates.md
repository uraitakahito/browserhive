---
title: TLS 証明書
description: TLS 用の CA / サーバ証明書の作成・検証と、HTTPS でのサーバ起動・呼び出し
---

BrowserHive で TLS を有効にするために必要な証明書の作り方を説明する。

## 概要

TLS(サーバ認証)には次のファイルが必要:

| ファイル | 用途 | 使う側 |
|------|---------|---------|
| `ca.crt` | CA 証明書 | クライアント(サーバ検証用) |
| `server.crt` | サーバ証明書 | サーバ |
| `server.key` | サーバ秘密鍵 | サーバ |

## 証明書の作成手順

### 前提条件

OpenSSL がインストールされていること:

```bash
openssl version
```

### Step 1: 作業ディレクトリを作る

```bash
mkdir -p certs
cd certs
```

### Step 2: CA(認証局)を作る

```bash
# CA 秘密鍵を生成(4096 bit)
openssl genrsa -out ca.key 4096

# CA 証明書を生成(有効期間 365 日)
openssl req -new -x509 -days 365 -key ca.key -out ca.crt -subj "/CN=BrowserHive CA/O=BrowserHive/C=JP"
```

### Step 3: サーバ証明書を作る

```bash
# サーバ秘密鍵を生成
openssl genrsa -out server.key 4096

# 証明書署名要求(CSR)を作成
openssl req -new -key server.key -out server.csr -subj "/CN=localhost/O=BrowserHive/C=JP"
```

### Step 4: SAN(Subject Alternative Name)設定ファイルを作る

サーバ証明書には、クライアントが接続に使うホスト名または IP アドレスを含める必要がある:

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

#### コンテナ環境の追加例

コンテナ間アクセスでは、クライアントは BrowserHive にコンテナ IP
(Apple Container がコンテナ毎に割り当てる)で到達する。そのため IP —
DNS を構成しているならカスタムホスト名 — を SAN リストに含める:

```
[alt_names]
DNS.1 = localhost
DNS.2 = browserhive-server   # カスタムホスト名(DNS を構成している場合)
IP.1 = 127.0.0.1
IP.2 = 192.168.64.10         # コンテナ IP(再起動で変わる)
```

### Step 5: サーバ証明書に署名する

```bash
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 365 -extfile server-ext.cnf
```

### Step 6: 中間ファイルを片付ける

```bash
rm -f server.csr ca.srl server-ext.cnf
```

### 最終的なファイル構成

```
certs/
├── ca.crt      # クライアントへ配布
├── ca.key      # 安全に保管(証明書更新に使用)
├── server.crt  # サーバが使用
└── server.key  # サーバが使用(安全に保管)
```

## 証明書の検証

### CA 証明書の内容を見る

```bash
openssl x509 -in certs/ca.crt -text -noout
```

### サーバ証明書の内容を見る

```bash
openssl x509 -in certs/server.crt -text -noout
```

### SAN を確認する

```bash
openssl x509 -in certs/server.crt -text -noout | grep -A1 "Subject Alternative Name"
```

### 証明書チェーンを検証する

```bash
openssl verify -CAfile certs/ca.crt certs/server.crt
```

## curl で接続する

TLS を有効にしたサーバへ curl で接続するには:

```bash
curl --cacert ./certs/ca.crt https://localhost:8080/v1/status
```

Node ベースのクライアント(例: `examples/data-client.ts`)では、グローバル
`fetch` が追加のトラストアンカーを拾えるよう `NODE_EXTRA_CA_CERTS` を使う:

```bash
NODE_EXTRA_CA_CERTS=./certs/ca.crt node dist/examples/data-client.js --server https://localhost:8080 --data data/smoke-test.yaml --png --accept-language "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7"
```

## サーバを起動する

同梱のサンプル証明書・秘密鍵でサーバを起動するには:

```sh
LOG_LEVEL=info npm run server -- \
  --browser-url http://192.168.64.x:9222 \
  --browser-url http://192.168.64.y:9222 \
  --s3-endpoint http://192.168.64.z:8333 --s3-bucket browserhive \
  --s3-access-key-id "$BROWSERHIVE_S3_ACCESS_KEY_ID" \
  --s3-secret-access-key "$BROWSERHIVE_S3_SECRET_ACCESS_KEY" \
  --tls-cert ./certs/sample-server.crt --tls-key ./certs/sample-server.key \
  --user-agent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" \
  | pino-pretty
```

## サーバを呼び出す

TLS 有効時は、クライアントを HTTPS の URL へ向け、CA バンドルを渡す。

curl では `--cacert`:

```bash
curl --cacert ./certs/sample-ca.crt https://localhost:8080/v1/status
```

Node ベースのクライアント(`examples/data-client.ts` を含む)では、プロセス起動前に
`NODE_EXTRA_CA_CERTS=/path/to/ca.crt` を設定する — Node のグローバル `fetch` が
追加のトラストアンカーを自動的に拾う:

```sh
NODE_EXTRA_CA_CERTS=./certs/sample-ca.crt \
  node dist/examples/data-client.js \
    --data data/smoke-test.yaml \
    --server https://localhost:8080 \
    --webp --html --limit 50 \
    --accept-language "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7" \
  | pino-pretty
```

## セキュリティ注意

1. **秘密鍵の保護**: `ca.key` と `server.key` は安全に保管し、アクセス権を制限する
   ```bash
   chmod 600 certs/*.key
   ```

2. **証明書の期限**: 本ガイドは有効期間 365 日。本番環境では適切な期限を設定し、失効前に更新する

3. **本番環境の推奨**:
   - 信頼された認証局(Let's Encrypt・商用 CA 等)からの証明書取得を検討する
   - 自己署名証明書は開発・テスト環境に限定する
