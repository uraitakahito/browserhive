---
title: Capture results
description: How to find out what became of a submitted capture — the per-task endpoint, the durable .result.json manifest, and which to use
---

`POST /v1/captures` is fire-and-forget: it answers **202** with a `taskId` and
the capture happens later. This page is about the other half — finding out
what became of that task.

There are two ways to ask, carrying **the same body**, so one parser handles
both:

| | Where | Lifetime |
|---|---|---|
| `GET /v1/captures/{taskId}` | In memory on the server | Bounded, lost on restart |
| `{taskId}_..._{labels}.result.json` | Next to the artifacts in the bucket | As durable as the artifacts |

## The report

```json
{
  "taskId": "2b9e63ec-06e6-47cc-ab37-cb8495993cd6",
  "correlationId": "abc123de",
  "url": "http://example.com/",
  "labels": ["smoke"],
  "status": "success",
  "httpStatusCode": 200,
  "timestamp": "2026-07-29T12:01:41.870Z",
  "captureProcessingTimeMs": 5971,
  "retryCount": 0,
  "workerIndex": 0,
  "artifacts": {
    "wacz": "s3://browserhive/2b9e63ec-..._abc123de_smoke.wacz"
  },
  "waczStats": { "totalRecorded": 2, "totalBodyBytes": 187, "totalBlocked": 0 },
  "completeness": { "bodylessUrls": [], "complete": true }
}
```

`status` is one of `success` · `failed` · `timeout` · `httpError`. **Only
`success` means artifacts exist** — the other three leave `artifacts` empty
and fill in `errorDetails`:

```json
{
  "taskId": "bb9b7bb7-d24e-4d55-8169-f5820d14aff0",
  "status": "failed",
  "retryCount": 2,
  "artifacts": {},
  "errorDetails": {
    "type": "internal",
    "message": "net::ERR_CONNECTION_REFUSED at http://example.com/"
  }
}
```

`artifacts` holds whatever the [artifact store](/storage/) returned, so the
keys never have to be reconstructed from the filename rules — an
`s3://bucket/key` URI for S3-compatible storage.

## The archive states its own gaps

`completeness` is in the API response, and **the same report is written into
the WACZ's `datapackage.json`**. An archive travels; an HTTP response does not.
Someone opening a WACZ three years from now can only ask the file.

```json title="datapackage.json (inside the WACZ)"
{
  "profile": "data-package",
  "wacz_version": "1.1.1",
  "browserhive:capture": {
    "completeness": { "bodylessUrls": [], "truncatedUrls": [], "complete": true },
    "coverage": { "scrollExhausted": true, "scrollSteps": 40, "scrolledPx": 32000 }
  }
}
```

**`completeness` and `coverage` answer different questions.**

`completeness` asks whether any recorded response lost its body — to a `304`,
or to a size cap. It is decided by the WARC alone.

`coverage` asks how far down the page the capture ever got.
`scrollExhausted: true` means scrolling stopped at its **step cap rather than
the end of the page**, so whatever lay below was never requested and leaves no
trace in the WARC at all. The example above is measured from
www.yahoo.co.jp: an infinite feed, cut at 40 steps (32,000px at the 1280×800
viewport). **`complete` is still `true` there.** Both are correct; they are
answers to different questions.

`settings` records what **applied**, not what was asked for. `cache`,
`archiveMode` and `viewport` all fall back to a server default when the request
omits them, and the archive keeps the resolution rather than the omission —
which is why a value appears for something you never sent. That is the point:
an archive has to be able to say whether it was captured with the cache cleared.

`devicePixelRatios` is a list because `multipass` runs two passes. A single
number would tell a reader the `_2x` variants are absent from an archive that
holds them.

`behaviors` is what actually ran (`enabled ∩ isMatch()`). Site behaviors never
appear in `enabled`, so copying the configuration would miss them.

`coverage` is absent entirely when behaviors did not run. "Did not look" and
"looked at all of it" are different claims, so no default is written.

The cut-short case is covered by an e2e against meadow's
[`/endless-feed`](https://uraitakahito.github.io/meadow/scenarios/) — a page
that grows as it is scrolled, so scrolling never reaches an end. It used to be
checked by hand against a real website.

:::note
On a capture that asked to be signed, this report is covered by the signature
too — the signature is over `datapackage.json`. It becomes a claim that cannot
be edited afterwards.
:::

## Asking the server

```bash
curl -sS -o result.json -w '%{http_code}\n' \
  http://localhost:8080/v1/captures/2b9e63ec-06e6-47cc-ab37-cb8495993cd6
```

| Code | Meaning |
|------|---------|
| `200` | Finished. `result.json` is the report above. |
| `202` | Still queued or in flight (retries included). Ask again. |
| `404` | Never submitted, **or** aged out of the cache. |

The 404 deliberately conflates those two: once a result is evicted the server
no longer holds what it would need to tell them apart. Do not read a 404 as
proof the task never existed.

The cache keeps the most recent `--result-cache-size` results (default 1000,
oldest evicted first) and does not survive a restart. See
[Environment variables](/environment-variables/).

## Reading the manifest instead

Every finished capture — **successful or not** — also writes its report to
the bucket next to the artifacts, under the same naming rules:

```
{taskId}_{correlationId}_{labels}.result.json
```

```bash
aws --endpoint-url http://localhost:8333 s3 cp \
  s3://browserhive/2b9e63ec-..._abc123de_smoke.result.json - | jq .status
```

Prefer this when **missing a result is not acceptable** — a client keeping its
own ledger, for instance. It survives eviction, a server restart, and a
consumer that was down for hours. The endpoint is the convenient option;
the manifest is the durable one.

:::caution[A manifest write can fail on its own]
The capture and its artifacts have already succeeded by the time the manifest
is written, so a failure there is logged (`Failed to write result manifest`)
and otherwise ignored — it never fails the capture. If the object store was
unreachable, the artifacts would not have been uploaded either.
:::

## Fleet-wide counts

`/v1/status` answers about the server, not a task. It reports queue depth plus
two cumulative counters:

```bash
curl -sS http://localhost:8080/v1/status | jq '{pending, processing, succeeded, failed}'
```

`succeeded` and `failed` are separate on purpose: a task is "no longer in the
pipeline" both when it produced artifacts and when the retry budget ran out,
and those are not interchangeable for anyone reconciling their own records.

`/v1/status` says nothing about a task that already left the queue, and its
`queue.pendingTasks` is truncated at `pendingLimit` — so a task missing from
it has not necessarily finished. Use `GET /v1/captures/{taskId}` for
per-task questions.
