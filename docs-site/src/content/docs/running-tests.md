---
title: Running the tests
description: The two Vitest projects and how to drive them — unit tests, the black-box E2E suite against a real stack, the @vitest/ui report, and what CI runs
---

The suite is split into **two Vitest projects**, and the split is the first
thing to understand because it decides what a given command will do:

| Project | What it is | Needs a running stack |
|---|---|---|
| `unit` | Everything under `test/`, excluding `test/e2e/**`. Fast, in-process. | No |
| `e2e` | `test/e2e/**/*.e2e.test.ts`. Black-box: talks to the stack over HTTP only. | **Yes** |

`pnpm test` runs **only** `unit`, so the E2E suite is never collected by
accident — a plain `pnpm test` cannot fail because you forgot to start
containers.

## Commands

| Command | Project | Output |
|---|---|---|
| `pnpm test` | unit | Terminal |
| `pnpm run test:e2e` | e2e | Terminal |
| `pnpm run test:all` | both | Terminal |
| `pnpm run test:ui` | unit | Interactive UI |
| `pnpm run test:ui:e2e` | e2e | Interactive UI |
| `pnpm run test:report` | unit | Static HTML in `html/` |
| `pnpm run test:report:e2e` | e2e | Static HTML in `html-e2e/` |

The `unit`-scoped commands are backed by a `pre*` hook that runs `prep`
(OpenAPI code generation + the build fingerprint), so the generated TypeScript
is fresh. The e2e-scoped commands have no such hook on purpose: they reach the
stack over HTTP and import no generated code, so `prep` would be wasted work.

## Unit tests

```sh
pnpm test
```

Nothing else is required. To narrow the run, pass a file or a name pattern
straight through:

```sh
pnpm exec vitest run --project unit test/storage/wacz
pnpm exec vitest run --project unit -t "retries"
```

## E2E tests

These capture real pages with a real Chromium and assert on what the fixture
origin observed, so the stack has to be up first:

```sh title="One-time on this machine — the project-named DNS domain"
sudo container system dns create browserhive
```

```sh title="Bring up SeaweedFS + a Chromium worker + the server + meadow"
container-compose --profile meadow up -d -b
```

```sh
pnpm run test:e2e
```

```sh title="Afterwards — pass the same --profile flags you used with up"
container-compose --profile meadow down
```

`container-compose` provides no readiness signal, so the suite waits for the
stack itself: `test/e2e/global-setup.ts` polls `/v1/status` once a second for
45 seconds and then **fails loudly** rather than skipping, telling you what to
start:

```
E2E stack not reachable at http://localhost:8080 after 45s —
bring it up first: container-compose --profile meadow up -d -b
```

A suite that silently skipped would look identical to a suite that passed,
which is the failure mode this avoids.

Endpoints are static by design — the API is published on localhost and the
fixture origin is reached through the platform DNS name, both of which resolve
from the host and from the Chromium workers. Point them elsewhere with
`E2E_API_URL` and `E2E_MEADOW_URL`.

The fixture origin is [meadow](https://uraitakahito.github.io/meadow/); what
each of its routes reproduces is on
[its Scenarios page](https://uraitakahito.github.io/meadow/scenarios/). For the
surrounding dev loop — running a work-in-progress server on the host against
these same containers — see [Development environment](/development-environment/).

## The UI

`@vitest/ui` gives the same view interactively or as a static bundle. It is
worth reaching for mainly on the E2E suite, because that is where the tests
annotate what they observed:

```sh
pnpm run test:ui:e2e
```

Each capture is annotated with its `taskId`, the server's own verdict
(`status`, `retryCount`) and where the artifacts landed — see
`test/e2e/helpers/capture.ts`. The UI renders these as a **Test Annotations**
panel, with the type, the message and the source location, and its **Code** tab
inlines each one at the `annotate()` call that produced it:

```
Test Annotations
  capture     taskId=156536c8-… url=http://meadow.browserhive:8080/flaky?fail=2&key=e2e
  capture     status=success retryCount=2
  artifacts   {"html":"s3://browserhive/156536c8-…_e2e.html"}
```

The assertions in that suite are about the fixture origin's hit counters, so
when one fails the first question is whether the capture succeeded at all.
These lines answer it without opening the server log, and the `taskId` is
annotated *before* the wait begins so it survives a timeout — exactly when you
need it to find the task in `container logs browserhive.browserhive`.

`test:ui` is deliberately scoped to the `unit` project. Without a project
filter Vitest also collects `e2e`, whose global setup spends its 45 seconds
waiting and then throws, so an unscoped UI is unusable unless the stack happens
to be running.

Besides the tree, the UI offers status filters (`Fail` / `Pass` / `Skip` /
`Only Tests` / `Slow`), a project switch, and a search box that also accepts
`tag:<expression>` if tags are ever declared in the config.

## Static reports

```sh
pnpm run test:report:e2e
```

The report is a Vite application: it fetches its data at runtime and therefore
**does not work over `file://`**. Serve it instead:

```sh
npx vite preview --outDir html-e2e
```

Both output directories (`html/`, `html-e2e/`) are gitignored, and excluded
from ESLint as well — the bundled report is not part of any TypeScript project.

Note that the report embeds the **full source of every test file it collected**,
whether or not anything failed. That is unremarkable for this repository, whose
tests are public anyway, but it is worth knowing before copying the setup into a
private one.

## What CI runs

| Workflow | Trigger | Runs |
|---|---|---|
| `ci.yml` | Every PR and push to `main`/`develop` | Build, examples build, ESLint, **unit** tests |
| `e2e.yml` | Manual dispatch only | The **e2e** suite on a self-hosted macOS runner |

E2E stays off the per-PR path: Apple Container does not run on GitHub-hosted
Linux, and the fast unit gate already covers every PR.

A dispatched E2E run uploads its report as an artifact named **`e2e-report`**.
Download it from the run's summary page, then serve it — the `file://` caveat
above applies to the downloaded copy too:

```sh
npx vite preview --outDir e2e-report
```

The run step is allowed to fail without stopping the upload, and the failure is
re-raised afterwards, so a red suite still produces a readable report.
