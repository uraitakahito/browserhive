# grpcurl Usage Guide

grpcurl is a tool for calling gRPC services from the command line. This project has Server Reflection enabled, so you can call the API without proto files.

## Basic Usage

### List Services

```bash
grpcurl -plaintext localhost:50051 list
```

### List Methods

```bash
grpcurl -plaintext localhost:50051 list browserhive.v1.CaptureService
```

### Describe Services/Messages

```bash
# Service details
grpcurl -plaintext localhost:50051 describe browserhive.v1.CaptureService

# Message type details
grpcurl -plaintext localhost:50051 describe browserhive.v1.CaptureRequest
```

## CaptureService API

### SubmitCapture RPC

Sends a request to capture a URL. Since this uses a fire-and-forget pattern, the response only returns the request acceptance result, and the actual capture is processed asynchronously.

```bash
grpcurl -plaintext -d '{
  "url": "https://example.com",
  "labels": ["example"],
  "correlation_id": "EXT-001",
  "capture_options": {
    "png": true,
    "jpeg": false,
    "html": true
  }
}' localhost:50051 browserhive.v1.CaptureService/SubmitCapture
```

#### Request Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | URL to capture |
| `labels` | string[] | No | Labels used for filename (multiple can be specified) |
| `correlation_id` | string | No | ID used for correlation on the client side |
| `capture_options` | object | Yes | Capture options (at least one must be true) |
| `capture_options.png` | bool | - | Capture PNG screenshot |
| `capture_options.jpeg` | bool | - | Capture JPEG screenshot |
| `capture_options.html` | bool | - | Capture HTML |

> **Note**: `capture_options` is required. At least one of `png`, `jpeg`, or `html` must be set to `true`. Omitting it or setting all to `false` will result in an error.

#### Filename Format

Generated filenames follow this format:

| Case | Format | Example |
|------|--------|---------|
| With labels | `{taskId}_{labels}.{ext}` | `550e8400-..._my-label.png` |
| Without labels | `{taskId}.{ext}` | `550e8400-....png` |
| Labels + correlationId | `{taskId}_{correlationId}_{labels}.{ext}` | `550e8400-..._abc123_my-label.png` |
| correlationId only | `{taskId}_{correlationId}.{ext}` | `550e8400-..._abc123.png` |

#### Response Example

```json
{
  "accepted": true,
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "correlation_id": "EXT-001"
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `accepted` | bool | Whether the request was accepted |
| `task_id` | string | Server-generated task ID (UUID, for log tracking) |
| `correlation_id` | string | Correlation ID specified in the request |
| `error` | string | Error message when `accepted=false` |

### GetStatus RPC

Gets the current status of the queue and worker pool.

```bash
grpcurl -plaintext localhost:50051 browserhive.v1.CaptureService/GetStatus
```

#### Response Example

```json
{
  "pending": 5,
  "processing": 2,
  "completed": 10,
  "healthyWorkers": 2,
  "totalWorkers": 2,
  "isRunning": true
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `pending` | int32 | Number of tasks waiting in queue |
| `processing` | int32 | Number of tasks being processed |
| `completed` | int32 | Number of completed tasks |
| `healthy_workers` | int32 | Number of healthy workers |
| `total_workers` | int32 | Total number of workers |
| `is_running` | bool | Whether the worker pool is running |

## TLS (Transport Layer Security)

When using TLS, specify the certificate with the `-cacert` option.

```bash
grpcurl -cacert ./certs/sample-ca.crt localhost:50051 browserhive.v1.CaptureService/GetStatus
```
