# HTTP API Usage Guide

The OpenAPI 3.1 specification for the Capture API lives in
[`src/http/openapi.yaml`](../src/http/openapi.yaml). The running server
intentionally does not expose `/docs` or `/openapi.yaml`; Redoc-rendered
reference docs are published as a separate static artifact via the
GitHub Pages workflow (`.github/workflows/docs.yml`).

## Endpoints

### `POST /v1/captures` (SubmitCapture)

Submit a capture request for a single URL. Fire-and-forget: returns
`202 Accepted` immediately, the actual capture is processed asynchronously.

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
```

#### Request body fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | Yes | — | URL to capture |
| `labels` | string[] | No | `[]` | Labels used for filename (multiple can be specified) |
| `correlationId` | string | No | (unset) | ID echoed back on the acceptance response, useful for client-side correlation |
| `captureFormats` | object | Yes | — | Capture output formats (at least one of `png`/`jpeg`/`html` must be true) |
| `captureFormats.png` | bool | — | `false` | Capture PNG screenshot |
| `captureFormats.jpeg` | bool | — | `false` | Capture JPEG screenshot |
| `captureFormats.html` | bool | — | `false` | Capture HTML |
| `dismissBanners` | bool | No | `false` | Strip cookie-consent banners and large fixed/sticky overlays before capturing. Best-effort: dismissal failures do not fail the capture. The dismissal report (framework + selectors removed) appears in the server log line for the completed task. |

#### Filename format

| Case | Format | Example |
|------|--------|---------|
| With labels | `{taskId}_{labels}.{ext}` | `550e8400-..._my-label.png` |
| Without labels | `{taskId}.{ext}` | `550e8400-....png` |
| Labels + correlationId | `{taskId}_{correlationId}_{labels}.{ext}` | `550e8400-..._abc123_my-label.png` |
| correlationId only | `{taskId}_{correlationId}.{ext}` | `550e8400-..._abc123.png` |

#### Success response (`202 Accepted`)

```json
{
  "accepted": true,
  "taskId": "550e8400-e29b-41d4-a716-446655440000",
  "correlationId": "EXT-001"
}
```

| Field | Type | Presence | Description |
|-------|------|----------|-------------|
| `accepted` | bool | always | `true` (errors are surfaced as 4xx/5xx with `application/problem+json` body) |
| `taskId` | string (uuid) | always | Server-generated task ID, useful for matching server log lines |
| `correlationId` | string | only when provided in the request | Echoed back from the request |

#### Error responses

Failures use `Content-Type: application/problem+json` (RFC 7807).

| Status | Title | When |
|--------|-------|------|
| `400` | Validation failed | `url` missing, `captureFormats` all false, invalid label/correlationId chars |
| `409` | Duplicate URL | `--reject-duplicate-urls` is enabled and the URL is already pending or in flight |
| `503` | No operational workers available | The coordinator has zero healthy workers (request again once at least one reconnects) |

```json
{
  "type": "about:blank",
  "title": "Validation failed",
  "status": 400,
  "detail": "At least one capture format must be enabled (png, jpeg, or html)"
}
```

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

| Field | Type | Description |
|-------|------|-------------|
| `pending` | int32 | Number of tasks waiting in queue |
| `processing` | int32 | Number of tasks being processed |
| `completed` | int32 | Number of completed tasks |
| `operationalWorkers` | int32 | Number of operational workers |
| `totalWorkers` | int32 | Total number of workers |
| `isRunning` | bool | Whether the coordinator is in the `running` lifecycle state (all workers healthy) |
| `isDegraded` | bool | Whether the coordinator is in the `degraded` lifecycle state (some/all workers unhealthy; retry loop is running) |
| `workers` | WorkerInfo[] | Detailed per-worker information (empty array if no workers configured) |

## TLS

When TLS is enabled (`--tls-cert` / `--tls-key`), point clients at the
HTTPS URL and supply the CA bundle:

```bash
curl --cacert ./certs/sample-ca.crt https://localhost:8080/v1/status
```

For Node-based clients (including `examples/csv-client.ts`), set
`NODE_EXTRA_CA_CERTS=/path/to/ca.crt` before starting the process — the
global `fetch` will pick the additional trust anchor up automatically.
