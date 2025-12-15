/**
 * Task Queue for Capture Tasks
 */
import type { CaptureTask } from "./types.js";

export interface QueueStatus {
  pending: number;
  processing: number;
  completed: number;
}

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

  dequeue(): CaptureTask | undefined {
    const task = this.queue.shift();
    if (task) {
      this.processing.add(task.taskId);
      this.processingUrls.set(task.taskId, task.url);
    }
    return task;
  }

  requeue(task: CaptureTask): void {
    this.processing.delete(task.taskId);
    this.processingUrls.delete(task.taskId);
    const retriedTask: CaptureTask = {
      ...task,
      retryCount: task.retryCount + 1,
    };
    this.queue.push(retriedTask);
  }

  markComplete(taskId: string): void {
    this.processing.delete(taskId);
    this.processingUrls.delete(taskId);
    this.completed.add(taskId);
  }

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

  getStatus(): QueueStatus {
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
