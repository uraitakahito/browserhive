import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validateFilename,
  validateLabels,
  generateFilename,
  withTimeout,
  hideScrollbars,
  isSuccessHttpStatus,
  setUserAgent,
  INVALID_FILENAME_CHARS_LIST,
  LABELS_SEPARATOR,
} from "../../src/capture/page-capturer.js";
import type { CaptureTask } from "../../src/capture/types.js";
import type { Page } from "puppeteer";

const createTask = (overrides: Partial<CaptureTask> = {}): CaptureTask => ({
  taskId: "test-uuid-1234",
  labels: ["TestTask"],
  url: "https://example.com",
  retryCount: 0,
  captureOptions: { png: true, jpeg: false, html: true },
  ...overrides,
});

describe("validateFilename", () => {
  it("should return invalid for invalid characters", () => {
    const result1 = validateFilename("file<>name");
    expect(result1.valid).toBe(false);
    if (!result1.valid) {
      expect(result1.error).toContain("invalid characters");
    }

    const result2 = validateFilename('file:"name');
    expect(result2.valid).toBe(false);

    const result3 = validateFilename("file/\\name");
    expect(result3.valid).toBe(false);

    const result4 = validateFilename("file|?*name");
    expect(result4.valid).toBe(false);
  });

  it("should return invalid for whitespace", () => {
    const result1 = validateFilename("file name");
    expect(result1.valid).toBe(false);
    if (!result1.valid) {
      expect(result1.error).toContain("whitespace");
    }

    const result2 = validateFilename("file\tname");
    expect(result2.valid).toBe(false);

    const result3 = validateFilename("file\nname");
    expect(result3.valid).toBe(false);
  });

  it("should return invalid for filename exceeding 100 characters", () => {
    const longName = "a".repeat(101);
    const result = validateFilename(longName);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("exceeds");
    }
  });

  it("should return invalid for empty string", () => {
    const result = validateFilename("");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("empty");
    }
  });

  it("should return valid for valid filename", () => {
    const result1 = validateFilename("valid-file-name.123");
    expect(result1.valid).toBe(true);

    const result2 = validateFilename("a".repeat(100));
    expect(result2.valid).toBe(true);
  });

  it("should include filename in error message", () => {
    const result = validateFilename("file:name");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("file:name");
      expect(result.error).toContain("invalid characters");
    }
  });
});

describe("INVALID_FILENAME_CHARS_LIST", () => {
  it("should contain all expected invalid characters", () => {
    expect(INVALID_FILENAME_CHARS_LIST).toContain("<");
    expect(INVALID_FILENAME_CHARS_LIST).toContain(">");
    expect(INVALID_FILENAME_CHARS_LIST).toContain(":");
    expect(INVALID_FILENAME_CHARS_LIST).toContain('"');
    expect(INVALID_FILENAME_CHARS_LIST).toContain("/");
    expect(INVALID_FILENAME_CHARS_LIST).toContain("\\");
    expect(INVALID_FILENAME_CHARS_LIST).toContain("|");
    expect(INVALID_FILENAME_CHARS_LIST).toContain("?");
    expect(INVALID_FILENAME_CHARS_LIST).toContain("*");
    expect(INVALID_FILENAME_CHARS_LIST).toContain("_");
  });

  it("should have exactly 10 characters", () => {
    expect(INVALID_FILENAME_CHARS_LIST).toHaveLength(10);
  });

  it("should reject each invalid character individually", () => {
    for (const char of INVALID_FILENAME_CHARS_LIST) {
      const result = validateFilename(`file${char}name`);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("invalid characters");
      }
    }
  });
});

describe("validateLabels", () => {
  it("should return valid for empty array (labels are optional)", () => {
    const result = validateLabels([]);
    expect(result.valid).toBe(true);
  });

  it("should return valid for single valid label", () => {
    const result = validateLabels(["valid-label"]);
    expect(result.valid).toBe(true);
  });

  it("should return valid for multiple valid labels", () => {
    const result = validateLabels(["label1", "label2", "label3"]);
    expect(result.valid).toBe(true);
  });

  it("should return invalid if any label contains invalid characters", () => {
    const result = validateLabels(["valid", "inv:alid", "also-valid"]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("invalid characters");
    }
  });

  it("should return invalid if any label contains whitespace", () => {
    const result = validateLabels(["valid", "has space"]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("whitespace");
    }
  });

  it("should return invalid if any label is empty after trim", () => {
    const result = validateLabels(["valid", "   "]);
    expect(result.valid).toBe(false);
  });

  it("should return invalid if any label exceeds 100 characters", () => {
    const result = validateLabels(["valid", "a".repeat(101)]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("exceeds");
    }
  });
});

describe("LABELS_SEPARATOR", () => {
  it("should be a hyphen", () => {
    expect(LABELS_SEPARATOR).toBe("-");
  });
});

describe("generateFilename", () => {
  it("should generate filename with single label", () => {
    const task = createTask({
      taskId: "uuid-1234",
      labels: ["MyTask"],
    });

    const result = generateFilename(task, "png");
    expect(result).toBe("uuid-1234_MyTask.png");
  });

  it("should generate filename with multiple labels joined by hyphen", () => {
    const task = createTask({
      taskId: "uuid-1234",
      labels: ["category", "subcategory", "tag"],
    });

    const result = generateFilename(task, "png");
    expect(result).toBe("uuid-1234_category-subcategory-tag.png");
  });

  it("should generate filename with correlationId and single label", () => {
    const task = createTask({
      taskId: "uuid-1234",
      labels: ["MyTask"],
      correlationId: "ext-5678",
    });

    const result = generateFilename(task, "png");
    expect(result).toBe("uuid-1234_ext-5678_MyTask.png");
  });

  it("should generate filename with correlationId and multiple labels", () => {
    const task = createTask({
      taskId: "uuid-1234",
      labels: ["cat", "tag"],
      correlationId: "ext-5678",
    });

    const result = generateFilename(task, "png");
    expect(result).toBe("uuid-1234_ext-5678_cat-tag.png");
  });

  it("should handle different extensions", () => {
    const task = createTask({ taskId: "uuid", labels: ["Task"] });

    expect(generateFilename(task, "png")).toBe("uuid_Task.png");
    expect(generateFilename(task, "jpeg")).toBe("uuid_Task.jpeg");
    expect(generateFilename(task, "html")).toBe("uuid_Task.html");
  });

  it("should generate filename without labels part when labels is empty", () => {
    const task = createTask({
      taskId: "test-uuid",
      labels: [],
    });
    expect(generateFilename(task, "png")).toBe("test-uuid.png");
  });

  it("should generate filename with correlationId only when labels is empty", () => {
    const task = createTask({
      taskId: "test-uuid",
      labels: [],
      correlationId: "corr123",
    });
    expect(generateFilename(task, "png")).toBe("test-uuid_corr123.png");
  });
});

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should resolve when promise completes before timeout", async () => {
    const promise = Promise.resolve("success");

    const resultPromise = withTimeout(promise, 1000, "test operation");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe("success");
  });

  it("should reject when timeout occurs", async () => {
    const neverResolves = new Promise(() => {
      // Never resolves
    });

    const resultPromise = withTimeout(neverResolves, 100, "test operation");

    vi.advanceTimersByTime(100);

    await expect(resultPromise).rejects.toThrow("Timeout: test operation (100ms)");
  });

  it("should include timeout duration in error message", async () => {
    const neverResolves = new Promise(() => {
      // Never resolves
    });

    const resultPromise = withTimeout(neverResolves, 5000, "navigation");

    vi.advanceTimersByTime(5000);

    await expect(resultPromise).rejects.toThrow("Timeout: navigation (5000ms)");
  });

  it("should clear timeout when promise resolves first", async () => {
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

    const promise = Promise.resolve("done");
    const resultPromise = withTimeout(promise, 1000, "test");

    await vi.runAllTimersAsync();
    await resultPromise;

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it("should propagate promise rejection", async () => {
    const error = new Error("Original error");
    const failingPromise = Promise.reject(error);

    const resultPromise = withTimeout(failingPromise, 1000, "test");

    await expect(resultPromise).rejects.toThrow("Original error");
  });

  it("should return correct type", async () => {
    const promise = Promise.resolve({ value: 42 });

    const resultPromise = withTimeout(promise, 1000, "test");
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ value: 42 });
  });
});

describe("hideScrollbars", () => {
  interface StyleTagArg {
    content: string;
  }

  it("should call page.addStyleTag with scrollbar-hiding CSS", async () => {
    const mockAddStyleTag = vi.fn<(arg: StyleTagArg) => Promise<void>>();
    const mockPage = {
      addStyleTag: mockAddStyleTag,
    } as unknown as Page;

    await hideScrollbars(mockPage);

    expect(mockAddStyleTag).toHaveBeenCalledTimes(1);
    expect(mockAddStyleTag).toHaveBeenCalledWith({
      content: expect.stringContaining("::-webkit-scrollbar") as string,
    });
  });

  it("should include CSS for hiding scrollbars in Chromium", async () => {
    let capturedCss = "";
    const mockAddStyleTag = vi.fn<(arg: StyleTagArg) => Promise<void>>().mockImplementation((arg) => {
      capturedCss = arg.content;
      return Promise.resolve();
    });
    const mockPage = {
      addStyleTag: mockAddStyleTag,
    } as unknown as Page;

    await hideScrollbars(mockPage);

    // Chromium (WebKit/Blink)
    expect(capturedCss).toContain("::-webkit-scrollbar");
    expect(capturedCss).toContain("display: none");
  });
});

describe("isSuccessHttpStatus", () => {
  it("should return true for 200", () => {
    expect(isSuccessHttpStatus(200)).toBe(true);
  });

  it("should return true for 2xx status codes", () => {
    expect(isSuccessHttpStatus(201)).toBe(true);
    expect(isSuccessHttpStatus(204)).toBe(true);
    expect(isSuccessHttpStatus(299)).toBe(true);
  });

  it("should return false for 4xx status codes", () => {
    expect(isSuccessHttpStatus(400)).toBe(false);
    expect(isSuccessHttpStatus(403)).toBe(false);
    expect(isSuccessHttpStatus(404)).toBe(false);
  });

  it("should return false for 5xx status codes", () => {
    expect(isSuccessHttpStatus(500)).toBe(false);
    expect(isSuccessHttpStatus(502)).toBe(false);
    expect(isSuccessHttpStatus(503)).toBe(false);
  });

  it("should return false for 3xx status codes", () => {
    expect(isSuccessHttpStatus(301)).toBe(false);
    expect(isSuccessHttpStatus(302)).toBe(false);
  });

  it("should return false for 1xx status codes", () => {
    expect(isSuccessHttpStatus(100)).toBe(false);
    expect(isSuccessHttpStatus(101)).toBe(false);
  });

  it("should return false for 0 (no response)", () => {
    expect(isSuccessHttpStatus(0)).toBe(false);
  });
});

describe("setUserAgent", () => {
  it("should call page.setUserAgent when userAgent is provided", async () => {
    const mockSetUserAgent = vi.fn<(options: { userAgent: string }) => Promise<void>>();
    const mockPage = {
      setUserAgent: mockSetUserAgent,
    } as unknown as Page;

    await setUserAgent(mockPage, "Custom User-Agent");

    expect(mockSetUserAgent).toHaveBeenCalledTimes(1);
    expect(mockSetUserAgent).toHaveBeenCalledWith({ userAgent: "Custom User-Agent" });
  });

  it("should not call page.setUserAgent when userAgent is undefined", async () => {
    const mockSetUserAgent = vi.fn<(options: { userAgent: string }) => Promise<void>>();
    const mockPage = {
      setUserAgent: mockSetUserAgent,
    } as unknown as Page;

    await setUserAgent(mockPage, undefined);

    expect(mockSetUserAgent).not.toHaveBeenCalled();
  });
});
