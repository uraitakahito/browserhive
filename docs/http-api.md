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

#### Request body fields

See the [SubmitCapture reference](https://uraitakahito.github.io/browserhive/#operation/submitCapture) for the full request body schema.

#### Filename format

| Case | Format | Example |
|------|--------|---------|
| With labels | `{taskId}_{labels}.{ext}` | `550e8400-..._my-label.png` |
| Without labels | `{taskId}.{ext}` | `550e8400-....png` |
| Labels + correlationId | `{taskId}_{correlationId}_{labels}.{ext}` | `550e8400-..._abc123_my-label.png` |
| correlationId only | `{taskId}_{correlationId}.{ext}` | `550e8400-..._abc123.png` |

#### Example: dismissing a cookie-consent dialog

The Guardian (theguardian.com) uses Sourcepoint as its consent-management
platform; by default the consent dialog covers the entire viewport.
Setting `"dismissBanners": true` removes the banner — and any large
fixed/sticky overlay caught by the heuristic fallback — before the
screenshot is taken.

```bash
curl -i -X POST http://localhost:8080/v1/captures \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://www.theguardian.com",
    "labels": ["guardian"],
    "captureFormats": { "png": true },
    "dismissBanners": true
  }'
```

When the task completes, the server log line includes a `dismissReport`:

```json
{
  "msg": "Task completed",
  "url": "https://www.theguardian.com",
  "dismissReport": {
    "framework": "Sourcepoint",
    "removedSelectors": ["[id^=\"sp_message_container\"]"],
    "removedOverlayCount": 1
  }
}
```

- `framework` — matched CMP name, or `"heuristic"` when only the fallback fired, or `null` when nothing matched.
- `removedSelectors` — exact CSS selectors whose elements were removed in the CMP-selector pass.
- `removedOverlayCount` — number of elements removed by the heuristic pass (fixed/sticky elements with high `z-index` that cover ≥30% of the viewport, excluding semantic landmarks).

Dismissal is best-effort: a thrown error inside the page is caught and an empty report is returned, so a malformed page cannot fail the capture.

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

See the [GetStatus reference](https://uraitakahito.github.io/browserhive/#operation/getStatus) for the response schema.

## TLS

When TLS is enabled (`--tls-cert` / `--tls-key`), point clients at the
HTTPS URL and supply the CA bundle:

```bash
curl --cacert ./certs/sample-ca.crt https://localhost:8080/v1/status
```

For Node-based clients (including `examples/csv-client.ts`), set
`NODE_EXTRA_CA_CERTS=/path/to/ca.crt` before starting the process — the
global `fetch` will pick the additional trust anchor up automatically.
