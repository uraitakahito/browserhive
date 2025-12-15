import { describe, it, expect, beforeEach } from "vitest";
import { TaskQueue } from "../../src/capture/task-queue.js";
import type { CaptureTask } from "../../src/capture/types.js";

const createTask = (id: string, overrides: Partial<CaptureTask> = {}): CaptureTask => ({
  taskId: id,
  labels: [`Task${id}`],
  url: `https://example.com/${id}`,
  retryCount: 0,
  captureOptions: { png: true, jpeg: false, html: true },
  ...overrides,
});

describe("TaskQueue", () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue();
  });

  describe("enqueue/dequeue", () => {
    it("should add and retrieve a task", () => {
      const task = createTask("1");
      queue.enqueue(task);

      const retrieved = queue.dequeue();
      expect(retrieved).toEqual(task);
    });

    it("should return undefined when queue is empty", () => {
      const retrieved = queue.dequeue();
      expect(retrieved).toBeUndefined();
    });

    it("should mark task as processing when dequeued", () => {
      const task = createTask("1");
      queue.enqueue(task);

      expect(queue.processingCount).toBe(0);
      queue.dequeue();
      expect(queue.processingCount).toBe(1);
    });
  });

  describe("enqueueAll", () => {
    it("should add multiple tasks at once", () => {
      const tasks = [createTask("1"), createTask("2"), createTask("3")];
      queue.enqueueAll(tasks);

      expect(queue.remaining).toBe(3);
    });

    it("should maintain order when adding multiple tasks", () => {
      const tasks = [createTask("1"), createTask("2"), createTask("3")];
      queue.enqueueAll(tasks);

      expect(queue.dequeue()?.taskId).toBe("1");
      expect(queue.dequeue()?.taskId).toBe("2");
      expect(queue.dequeue()?.taskId).toBe("3");
    });
  });

  describe("requeue", () => {
    it("should increment retryCount when requeuing", () => {
      const task = createTask("1", { retryCount: 0 });
      queue.enqueue(task);
      const dequeued = queue.dequeue();
      expect(dequeued).toBeDefined();

      queue.requeue(dequeued!);

      const requeued = queue.dequeue();
      expect(requeued?.retryCount).toBe(1);
    });

    it("should remove task from processing set", () => {
      const task = createTask("1");
      queue.enqueue(task);
      const dequeued = queue.dequeue();
      expect(dequeued).toBeDefined();

      expect(queue.processingCount).toBe(1);
      queue.requeue(dequeued!);
      expect(queue.processingCount).toBe(0);
    });

    it("should add task to the end of the queue", () => {
      const task1 = createTask("1");
      const task2 = createTask("2");
      queue.enqueue(task1);
      queue.enqueue(task2);

      const dequeued = queue.dequeue(); // task1
      expect(dequeued).toBeDefined();
      queue.requeue(dequeued!);

      expect(queue.dequeue()?.taskId).toBe("2");
      expect(queue.dequeue()?.taskId).toBe("1");
    });
  });

  describe("markComplete", () => {
    it("should move task from processing to completed", () => {
      const task = createTask("1");
      queue.enqueue(task);
      queue.dequeue();

      expect(queue.processingCount).toBe(1);
      expect(queue.completedCount).toBe(0);

      queue.markComplete(task.taskId);

      expect(queue.processingCount).toBe(0);
      expect(queue.completedCount).toBe(1);
    });
  });

  describe("remaining", () => {
    it("should return the number of tasks in queue", () => {
      expect(queue.remaining).toBe(0);

      queue.enqueue(createTask("1"));
      expect(queue.remaining).toBe(1);

      queue.enqueue(createTask("2"));
      expect(queue.remaining).toBe(2);

      queue.dequeue();
      expect(queue.remaining).toBe(1);
    });
  });

  describe("processingCount", () => {
    it("should track tasks being processed", () => {
      queue.enqueue(createTask("1"));
      queue.enqueue(createTask("2"));

      expect(queue.processingCount).toBe(0);

      queue.dequeue();
      expect(queue.processingCount).toBe(1);

      queue.dequeue();
      expect(queue.processingCount).toBe(2);
    });
  });

  describe("completedCount", () => {
    it("should track completed tasks", () => {
      queue.enqueue(createTask("1"));
      queue.enqueue(createTask("2"));

      queue.dequeue();
      queue.markComplete("1");
      expect(queue.completedCount).toBe(1);

      queue.dequeue();
      queue.markComplete("2");
      expect(queue.completedCount).toBe(2);
    });
  });

  describe("isDone", () => {
    it("should return true when queue is empty and no tasks processing", () => {
      expect(queue.isDone).toBe(true);
    });

    it("should return false when tasks are in queue", () => {
      queue.enqueue(createTask("1"));
      expect(queue.isDone).toBe(false);
    });

    it("should return false when tasks are processing", () => {
      queue.enqueue(createTask("1"));
      queue.dequeue();
      expect(queue.isDone).toBe(false);
    });

    it("should return true after all tasks completed", () => {
      queue.enqueue(createTask("1"));
      queue.dequeue();
      queue.markComplete("1");
      expect(queue.isDone).toBe(true);
    });
  });

  describe("hasNext", () => {
    it("should return true when queue has tasks", () => {
      queue.enqueue(createTask("1"));
      expect(queue.hasNext).toBe(true);
    });

    it("should return false when queue is empty", () => {
      expect(queue.hasNext).toBe(false);
    });

    it("should return false when all tasks are processing", () => {
      queue.enqueue(createTask("1"));
      queue.dequeue();
      expect(queue.hasNext).toBe(false);
    });
  });

  describe("FIFO order", () => {
    it("should process tasks in FIFO order", () => {
      queue.enqueue(createTask("1"));
      queue.enqueue(createTask("2"));
      queue.enqueue(createTask("3"));
      queue.enqueue(createTask("4"));
      queue.enqueue(createTask("5"));

      expect(queue.dequeue()?.taskId).toBe("1");
      expect(queue.dequeue()?.taskId).toBe("2");
      expect(queue.dequeue()?.taskId).toBe("3");
      expect(queue.dequeue()?.taskId).toBe("4");
      expect(queue.dequeue()?.taskId).toBe("5");
      expect(queue.dequeue()).toBeUndefined();
    });
  });

  describe("hasUrl", () => {
    it("should return true when URL exists in pending queue", () => {
      const task = createTask("1", { url: "https://example.com/page" });
      queue.enqueue(task);
      expect(queue.hasUrl("https://example.com/page")).toBe(true);
    });

    it("should return true when URL is being processed", () => {
      const task = createTask("1", { url: "https://example.com/page" });
      queue.enqueue(task);
      queue.dequeue();
      expect(queue.hasUrl("https://example.com/page")).toBe(true);
    });

    it("should return false when URL is not in queue", () => {
      expect(queue.hasUrl("https://example.com/page")).toBe(false);
    });

    it("should return false after URL is completed", () => {
      const task = createTask("1", { url: "https://example.com/page" });
      queue.enqueue(task);
      queue.dequeue();
      queue.markComplete(task.taskId);
      expect(queue.hasUrl("https://example.com/page")).toBe(false);
    });

    it("should return true when URL is requeued", () => {
      const task = createTask("1", { url: "https://example.com/page" });
      queue.enqueue(task);
      const dequeued = queue.dequeue();
      expect(dequeued).toBeDefined();
      queue.requeue(dequeued!);
      expect(queue.hasUrl("https://example.com/page")).toBe(true);
    });

    it("should handle multiple tasks with different URLs", () => {
      queue.enqueue(createTask("1", { url: "https://example.com/a" }));
      queue.enqueue(createTask("2", { url: "https://example.com/b" }));

      expect(queue.hasUrl("https://example.com/a")).toBe(true);
      expect(queue.hasUrl("https://example.com/b")).toBe(true);
      expect(queue.hasUrl("https://example.com/c")).toBe(false);
    });
  });

  describe("getStatus", () => {
    it("should return correct status for empty queue", () => {
      const status = queue.getStatus();

      expect(status).toEqual({
        pending: 0,
        processing: 0,
        completed: 0,
      });
    });

    it("should return correct status with pending tasks", () => {
      queue.enqueue(createTask("1"));
      queue.enqueue(createTask("2"));

      const status = queue.getStatus();

      expect(status).toEqual({
        pending: 2,
        processing: 0,
        completed: 0,
      });
    });

    it("should return correct status with processing and completed tasks", () => {
      queue.enqueue(createTask("1"));
      queue.enqueue(createTask("2"));
      queue.enqueue(createTask("3"));

      queue.dequeue(); // 1 -> processing
      queue.markComplete("1"); // 1 -> completed
      queue.dequeue(); // 2 -> processing

      const status = queue.getStatus();

      expect(status).toEqual({
        pending: 1,
        processing: 1,
        completed: 1,
      });
    });
  });
});
