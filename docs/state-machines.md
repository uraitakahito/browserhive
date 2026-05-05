# State Machines

The system uses [XState v5](https://stately.ai/docs) state machines with a Parent-Child Actor Model.

## Coordinator Lifecycle

`running` and `degraded` are substates of a compound `active` state. The
`watchWorkerHealth` invoke and the `SHUTDOWN` transition live on `active`,
so they are unaffected by `running ↔ degraded` oscillations.

Init failures are non-fatal: partial or total connect failures land in
`active.degraded` instead of `terminated`. While in `active.degraded`, the
coordinator periodically retries failed workers (1s → 2s → 4s → … capped at
60s) and lifts back to `active.running` once every worker is healthy.
`submitCapture` is accepted while in any `active.*` substate as long as at
least one worker is operational.

```mermaid
stateDiagram-v2
    [*] --> created
    created --> initializing : INITIALIZE
    initializing --> active.running : allHealthy
    initializing --> active.degraded : some failed

    state active {
        [*] --> running
        running --> degraded : WORKER_DEGRADED
        degraded --> running : ALL_WORKERS_HEALTHY
    }

    active --> shuttingDown : SHUTDOWN
    shuttingDown --> terminated : shutdownWorkers ok
    shuttingDown --> terminated : shutdownWorkers err (timeout)
    terminated --> [*]
```

## Capture Worker

Each capture worker actor uses compound states. The `operational` state invokes a `fromCallback` worker loop that polls the task queue and processes captures. The `connecting` and `disconnecting` states invoke `fromPromise` actors that return `Result<void, ErrorDetails>` instead of throwing — the machine branches in `onDone` on `event.output.ok`. Disconnect failures still transition to `disconnected` (best-effort) but log the underlying error. From `error`, the coordinator's retry actor (running while in the `degraded` lifecycle) sends `CONNECT` to bring the worker back through `connecting`.

```mermaid
stateDiagram-v2
    [*] --> disconnected
    disconnected --> connecting : CONNECT

    connecting --> operational : success
    connecting --> error : failure

    state operational {
        [*] --> idle
        idle --> processing : TASK_STARTED
        processing --> idle : TASK_DONE
        processing --> idle : TASK_FAILED
    }

    operational --> error : CONNECTION_LOST
    operational --> disconnecting : DISCONNECT

    error --> connecting : CONNECT (retry)
    error --> disconnecting : DISCONNECT

    disconnecting --> disconnected : done
```

| State | Tags | Description |
|-------|------|-------------|
| `disconnected` | | Not connected to remote browser (initial or after disconnect) |
| `connecting` | | Connecting to remote browser (invoke) |
| `operational.idle` | `healthy`, `canProcess` | Ready to accept tasks |
| `operational.processing` | `healthy` | Processing a capture task |
| `error` | | Connection lost or connect failure |
| `disconnecting` | | Disconnecting browser (invoke) |
