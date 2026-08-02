/**
 * Capture Coordinator
 *
 * Coordinates capture task processing across multiple workers.
 * Uses the Parent-Child Actor Model: drives a coordinator lifecycle
 * actor that spawns and orchestrates worker status actors itself.
 */
import { createActor, type SnapshotFrom } from "xstate";
import type {
  BrowserProfile,
  CaptureConfig,
  SigningConfig,
  CoordinatorConfig,
  DiscoveryConfig,
} from "../config/index.js";
import { DEFAULT_CAPTURE_CONFIG } from "../config/index.js";
import type { WorkerRegistry } from "../discovery/worker-registry.js";
import { resolveWithInitRetry } from "../discovery/init-retry.js";
import { createChildLogger, logger } from "../logger.js";
import {
  ManifestWriter,
  S3CompatibleArtifactStore,
  type ArtifactStore,
} from "../storage/index.js";
import { err, ok, type Result } from "../result.js";
import type { TaskQueue, TaskCounts } from "./task-queue.js";
import { compositeSink, type CaptureResultSink } from "./result-sink.js";
import { InMemoryResultStore } from "./in-memory-result-store.js";
import type { CaptureResult, CaptureTask, WorkerInfo } from "./types.js";
import { coordinatorMachine } from "./coordinator-machine.js";
import type { CaptureWorker } from "./capture-worker.js";

/** Argument type accepted by `snapshot.matches()` for the coordinator machine. */
type LifecycleMatchesArg = Parameters<SnapshotFrom<typeof coordinatorMachine>["matches"]>[0];

/**
 * View of a task currently held by a worker. Aggregated from
 * `WorkerInfo.currentTask` so the wire layer does not need to traverse
 * `workers` itself.
 */
export interface ProcessingTaskView {
  workerIndex: number;
  task: CaptureTask;
  startedAt: string;
}

export interface CoordinatorStatusReport {
  taskCounts: TaskCounts;
  operationalWorkers: number;
  totalWorkers: number;
  isRunning: boolean;
  isDegraded: boolean;
  workers: WorkerInfo[];
  /**
   * Snapshot of the head of the pending queue (size capped by the caller).
   * Tasks are returned without being removed from the queue.
   */
  pendingTasks: CaptureTask[];
  /** All tasks currently being processed (one entry per busy worker). */
  processingTasks: ProcessingTaskView[];
}

/** Default pending-task snapshot size used by `getStatus` when no override is given. */
export const DEFAULT_PENDING_TASKS_LIMIT = 50;

/** Cap for the exponential boot-time membership-retry backoff. */
const INIT_RETRY_MAX_DELAY_MS = 4000;

export interface GetStatusOptions {
  /** Maximum number of pending tasks to include. Defaults to {@link DEFAULT_PENDING_TASKS_LIMIT}. */
  pendingLimit?: number;
}

/**
 * 取り込みのオーケストレーションを束ねるファサード。XState のルートアクター
 * (`coordinatorMachine`)を起動し、`enqueueTask` / `getStatus` を公開する。
 *
 * @glossary CaptureCoordinator
 * @category コンポーネント
 */
export class CaptureCoordinator {
  private lifecycleActor;
  private store: ArtifactStore;
  private resultCache: InMemoryResultStore;
  private resultSink: CaptureResultSink;
  private registry: WorkerRegistry;
  private discovery: DiscoveryConfig;
  private unsubscribeMembership: (() => void) | null = null;

  constructor(
    config: CoordinatorConfig,
    registry: WorkerRegistry,
    discovery: DiscoveryConfig,
  ) {
    this.store = new S3CompatibleArtifactStore(config.storage);
    this.registry = registry;
    this.discovery = discovery;
    // Two sinks for the same results, with different lifetimes: the cache
    // backs `GET /v1/captures/{taskId}` and is bounded and volatile (a size
    // of 0 is a legitimate configuration); the manifest is the durable
    // record a downstream ledger can reconcile against after an outage.
    this.resultCache = new InMemoryResultStore(config.resultCacheSize);
    this.resultSink = compositeSink([
      this.resultCache,
      new ManifestWriter(this.store, createChildLogger({ component: "manifest-writer" })),
    ]);
    this.lifecycleActor = createActor(coordinatorMachine, {
      input: { config, store: this.store, resultSink: this.resultSink },
    });
    this.lifecycleActor.start();
  }

  /**
   * Boot-time membership resolution with exponential backoff. A cold stack can
   * start browserhive before the chromium workers' DNS names are registered
   * (`resolveMembers` throws when every declared host is NXDOMAIN), so retry a
   * few times to absorb that registration race. After the attempts are spent
   * the error is rethrown — a genuinely worker-less stack still fails loudly.
   * Only used at startup; the runtime refresh already tolerates zero workers.
   */
  private async resolveInitialMembers(): Promise<BrowserProfile[]> {
    return resolveWithInitRetry(
      () => this.registry.list(),
      {
        attempts: this.discovery.initRetryAttempts,
        delayMs: this.discovery.initRetryDelayMs,
        maxDelayMs: INIT_RETRY_MAX_DELAY_MS,
      },
      {
        onRetry: (info) => {
          logger.warn(
            info,
            "worker discovery found no members at boot — retrying (DNS registration race?)",
          );
        },
      },
    );
  }

  private get config(): CoordinatorConfig {
    return this.lifecycleActor.getSnapshot().context.config;
  }

  private get taskQueue(): TaskQueue {
    return this.lifecycleActor.getSnapshot().context.taskQueue;
  }

  private get workers(): CaptureWorker[] {
    return this.lifecycleActor.getSnapshot().context.workers;
  }

  /**
   * Worker spawning and browser connection are driven by the lifecycle
   * machine. Init failures do not abort startup.
   */
  async initialize(): Promise<void> {
    // fail-fast on storage misconfiguration (e.g. missing S3 bucket /
    // unwritable output directory) BEFORE spawning workers, so the
    // operator sees the cause directly instead of a cascade of capture
    // failures inside `errorHistory`.
    await this.store.initialize();
    // Membership (discovery) is resolved by the registry, separate from
    // health (monitoring). Seed the machine with the resolved member set
    // before spawning workers, so absent workers are never spawned.
    const members = await this.resolveInitialMembers();
    this.lifecycleActor.send({ type: "SET_MEMBERS", members });
    this.lifecycleActor.send({ type: "INITIALIZE" });
    await this.waitForLifecycle("active");

    // Track membership changes: a dynamic registry (DnsRegistry) emits the
    // new member set, which the machine reconciles without a restart. A
    // StaticRegistry never emits, so this is inert under the default config.
    this.unsubscribeMembership = this.registry.subscribe((changed) => {
      this.lifecycleActor.send({ type: "MEMBERSHIP_CHANGED", members: changed });
    });
  }

  enqueueTask(task: CaptureTask): Result<void, string> {
    if (this.config.rejectDuplicateUrls) {
      if (this.taskQueue.hasUrl(task.url)) {
        return err(`URL already in queue: ${task.url}`);
      }
    }
    this.taskQueue.enqueue(task);
    return ok();
  }

  /**
   * The recorded result for a finished task, if it is still cached.
   *
   * `undefined` covers two different situations the caller must distinguish
   * with {@link isTracking}: the task is still running, or it is unknown /
   * already evicted.
   */
  getResult(taskId: string): CaptureResult | undefined {
    return this.resultCache.get(taskId);
  }

  /** Whether the task is still waiting in the queue or held by a worker. */
  isTracking(taskId: string): boolean {
    return this.taskQueue.isTracking(taskId);
  }

  async shutdown(): Promise<void> {
    this.unsubscribeMembership?.();
    this.unsubscribeMembership = null;
    if (!this.lifecycleActor.getSnapshot().can({ type: "SHUTDOWN" })) {
      return;
    }
    this.lifecycleActor.send({ type: "SHUTDOWN" });
    await this.waitForLifecycle("terminated");
  }

  /** True when the lifecycle is in `active.running` (all workers healthy). */
  get isRunning(): boolean {
    return this.lifecycleActor.getSnapshot().matches({ active: "running" });
  }

  /** True when the lifecycle is in `active.degraded` (some workers unhealthy, retry loop running). */
  get isDegraded(): boolean {
    return this.lifecycleActor.getSnapshot().matches({ active: "degraded" });
  }

  /**
   * True when the coordinator is accepting traffic — any `active.*` substate,
   * or `reconciling` (a membership change is being applied while existing
   * workers keep serving). Used by the HTTP layer to admit captures.
   */
  get isActive(): boolean {
    const snapshot = this.lifecycleActor.getSnapshot();
    return snapshot.matches("active") || snapshot.matches("reconciling");
  }

  get operationalWorkerCount(): number {
    return this.workers.filter((worker) => worker.isHealthy).length;
  }

  /**
   * Server-wide capture defaults. The HTTP layer's request-mapper reads
   * this to resolve per-request `resetState` (and any other future
   * config-defaulted field) against the configured server policy. All
   * browser profiles share the same `CaptureConfig` instance via
   * `server-cli.ts:buildServerConfig`, so the first profile is
   * authoritative; the fallback to `DEFAULT_CAPTURE_CONFIG` exists only
   * for tests that wire a coordinator with zero profiles.
   */
  get captureDefaults(): CaptureConfig {
    return this.config.browserProfiles[0]?.capture ?? DEFAULT_CAPTURE_CONFIG;
  }

  /**
   * Server-wide signing settings, for the HTTP layer to resolve requests
   * against. Unlike `captureDefaults` there is no per-profile fallback to make
   * here — that is the point of it being server-wide.
   */
  get signing(): SigningConfig {
    return this.config.signing;
  }

  getStatus(opts: GetStatusOptions = {}): CoordinatorStatusReport {
    const pendingLimit = opts.pendingLimit ?? DEFAULT_PENDING_TASKS_LIMIT;
    const workerInfos = this.workers.map((worker) => worker.toInfo());
    const processingTasks: ProcessingTaskView[] = workerInfos.flatMap((info) =>
      info.currentTask
        ? [
            {
              workerIndex: info.index,
              task: info.currentTask.task,
              startedAt: info.currentTask.startedAt,
            },
          ]
        : [],
    );
    return {
      taskCounts: this.taskQueue.getStatus(),
      operationalWorkers: this.operationalWorkerCount,
      totalWorkers: this.workers.length,
      isRunning: this.isRunning,
      isDegraded: this.isDegraded,
      workers: workerInfos,
      pendingTasks: this.taskQueue.peekPending(pendingLimit),
      processingTasks,
    };
  }

  /**
   * Wait for the lifecycle actor to match one of the given state paths.
   * Each target is passed to `snapshot.matches()`, so compound paths
   * (e.g. `"active"` to cover both substates, or `"active.running"` for
   * one substate) work directly.
   */
  private async waitForLifecycle(
    ...targets: LifecycleMatchesArg[]
  ): Promise<void> {
    const isTarget = (): boolean => {
      const snapshot = this.lifecycleActor.getSnapshot();
      return targets.some((t) => snapshot.matches(t));
    };

    await new Promise<void>((resolve) => {
      if (isTarget()) {
        resolve();
        return;
      }
      const subscription = this.lifecycleActor.subscribe(() => {
        if (isTarget()) {
          subscription.unsubscribe();
          resolve();
        }
      });
    });
  }
}
