/**
 * Task Queue for Capture Tasks
 */
import type { CaptureTask } from "./types.js";

/** `markComplete` が記録する最終的な行方。 */
export type TaskOutcome = "succeeded" | "failed";

export interface TaskCounts {
  pending: number;
  processing: number;
  /** 撮れて成果物が上がった数。 */
  succeeded: number;
  /** リトライ上限まで使って諦めた数。 */
  failed: number;
}

/**
 * 取り込みタスクの共有キュー。FIFO の待機列に加え、処理中の集合と完了件数を持ち、
 * 全ワーカーが**同一インスタンス**を参照する(work-stealing)。`dequeue` で
 * 取り出すと同時に `processing` へ移し、完了で `markComplete`・再試行で `requeue` する。
 *
 * 完了したタスクは **件数しか残さない**(`succeeded` / `failed` のカウンタ)。
 * かつては taskId の `Set` を持っていたが、削除する経路が無く走らせるほど
 * 伸び続けていた。結果そのものを引きたい用途は `CaptureResultSink` が担う。
 *
 * @glossary TaskQueue
 * @category コンポーネント
 */
export class TaskQueue {
  private queue: CaptureTask[] = [];
  private processing = new Set<string>();
  private processingUrls = new Map<string, string>(); // taskId -> url
  private succeeded = 0;
  private failed = 0;

  enqueue(task: CaptureTask): void {
    this.queue.push(task);
  }

  enqueueAll(tasks: CaptureTask[]): void {
    this.queue.push(...tasks);
  }

  // #region dequeue
  dequeue(): CaptureTask | undefined {
    const task = this.queue.shift();
    if (task) {
      this.processing.add(task.taskId);
      this.processingUrls.set(task.taskId, task.url);
    }
    return task;
  }
  // #endregion

  // #region requeue
  requeue(task: CaptureTask): void {
    this.processing.delete(task.taskId);
    this.processingUrls.delete(task.taskId);
    // `enqueuedAt` is intentionally preserved so the task's true age stays
    // visible to /v1/status across retries — only `retryCount` is bumped.
    const retriedTask: CaptureTask = {
      ...task,
      retryCount: task.retryCount + 1,
    };
    this.queue.push(retriedTask);
  }
  // #endregion

  /**
   * Return up to `limit` tasks from the head of the pending queue without
   * removing them. Used by `/v1/status` to expose what's waiting.
   */
  peekPending(limit: number): CaptureTask[] {
    if (limit <= 0) return [];
    return this.queue.slice(0, limit);
  }

  // #region markComplete
  markComplete(taskId: string, outcome: TaskOutcome): void {
    this.processing.delete(taskId);
    this.processingUrls.delete(taskId);
    if (outcome === "succeeded") this.succeeded += 1;
    else this.failed += 1;
  }
  // #endregion

  /**
   * Whether this task is still in the pipeline (waiting or held by a worker).
   *
   * `GET /v1/captures/{taskId}` uses it to tell "still running" (202) from
   * "never heard of it" (404). Unlike `/v1/status`'s `pendingTasks`, this is
   * not truncated by `pendingLimit`, so it stays correct for a deep queue.
   */
  isTracking(taskId: string): boolean {
    if (this.processing.has(taskId)) return true;
    return this.queue.some((task) => task.taskId === taskId);
  }

  get remaining(): number {
    return this.queue.length;
  }

  get processingCount(): number {
    return this.processing.size;
  }

  get succeededCount(): number {
    return this.succeeded;
  }

  get failedCount(): number {
    return this.failed;
  }

  get isDone(): boolean {
    return this.queue.length === 0 && this.processing.size === 0;
  }

  get hasNext(): boolean {
    return this.queue.length > 0;
  }

  getStatus(): TaskCounts {
    return {
      pending: this.queue.length,
      processing: this.processing.size,
      succeeded: this.succeeded,
      failed: this.failed,
    };
  }

  hasUrl(url: string): boolean {
    const inQueue = this.queue.some((task) => task.url === url);
    if (inQueue) return true;

    for (const processingUrl of this.processingUrls.values()) {
      if (processingUrl === url) return true;
    }

    return false;
  }
}
