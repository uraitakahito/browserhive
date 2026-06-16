/**
 * Task Queue for Capture Tasks
 */
import type { CaptureTask } from "./types.js";

export interface TaskCounts {
  pending: number;
  processing: number;
  completed: number;
}

/**
 * 取り込みタスクの共有キュー。FIFO の待機列に加え、処理中 / 完了の集合を持ち、
 * 全ワーカーが**同一インスタンス**を参照する(work-stealing)。`dequeue` で
 * 取り出すと同時に `processing` へ移し、完了で `markComplete`・再試行で `requeue` する。
 *
 * @glossary TaskQueue
 * @category コンポーネント
 */
export class TaskQueue {
  private queue: CaptureTask[] = [];
  private processing = new Set<string>();
  private processingUrls = new Map<string, string>(); // taskId -> url
  private completed = new Set<string>();

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
  markComplete(taskId: string): void {
    this.processing.delete(taskId);
    this.processingUrls.delete(taskId);
    this.completed.add(taskId);
  }
  // #endregion

  get remaining(): number {
    return this.queue.length;
  }

  get processingCount(): number {
    return this.processing.size;
  }

  get completedCount(): number {
    return this.completed.size;
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
      completed: this.completed.size,
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
