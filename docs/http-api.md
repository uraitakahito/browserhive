# HTTP API Usage Guide

The OpenAPI 3.1 specification for the Capture API lives in
[`src/http/openapi.yaml`](../src/http/openapi.yaml).

## Endpoints

### `POST /v1/captures` (SubmitCapture)

Submit a capture request for a single URL.

```bash
curl -i -X POST http://localhost:8080/v1/captures \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "labels": ["example"],
    "correlationId": "EXT-001",
    "captureFormats": { "png": true, "jpeg": false, "html": true },
    "dismissBanners": true
  }'
# HTTP/1.1 202 Accepted
# content-type: application/json; charset=utf-8
# content-length: 91
# Date: Sun, 03 May 2026 08:00:21 GMT
# Connection: keep-alive
# Keep-Alive: timeout=72
#
# {"accepted":true,"taskId":"bbf18297-fce4-4759-a953-4921d1876803","correlationId":"EXT-001"}%
```

#### Reference

See the [SubmitCapture reference](https://uraitakahito.github.io/browserhive/#operation/submitCapture) for the full operation specification (request body, responses, status codes).

### `GET /v1/status` (GetStatus)

Get the current status of the queue and capture coordinator.

```bash
curl http://localhost:8080/v1/status
```

```json
{
  "pending": 5,
  "processing": 2,
  "completed": 10,
  "operationalWorkers": 2,
  "totalWorkers": 2,
  "isRunning": true,
  "isDegraded": false,
  "workers": []
}
```

See the [GetStatus reference](https://uraitakahito.github.io/browserhive/#operation/getStatus) for the full operation specification (response schema, status codes).

## TLS

When TLS is enabled (`--tls-cert` / `--tls-key`), point clients at the
HTTPS URL and supply the CA bundle:

```bash
curl --cacert ./certs/sample-ca.crt https://localhost:8080/v1/status
```

For Node-based clients (including `examples/csv-client.ts`), set
`NODE_EXTRA_CA_CERTS=/path/to/ca.crt` before starting the process — the
global `fetch` will pick the additional trust anchor up automatically.
