/**
 * PageCapturer integration test for per-task viewport and fullPage overrides.
 *
 * Confirms the override / fallback rules introduced when these settings
 * became per-request:
 *
 *   - `task.viewport` is preferred over `config.viewport` when present.
 *   - `task.viewport` absent → `config.viewport` is used.
 *   - `task.fullPage` is preferred over `config.screenshot.fullPage` when
 *     defined (including the explicit `false` case).
 *   - `task.fullPage` absent → `config.screenshot.fullPage` is used.
 *
 * Mirrors the mock-page approach used in `page-capturer-pdf.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Page } from "puppeteer";
import type { CaptureTask } from "../../src/capture/types.js";
import { PageCapturer } from "../../src/capture/page-capturer.js";
import {
  createTestArtifactStore,
  createTestCaptureConfig,
  type FakeArtifactStore,
} from "../helpers/config.js";

interface MockPage {
  setViewport: ReturnType<typeof vi.fn>;
  setUserAgent: ReturnType<typeof vi.fn>;
  setExtraHTTPHeaders: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  addStyleTag: ReturnType<typeof vi.fn>;
  content: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
  pdf: ReturnType<typeof vi.fn>;
  url: ReturnType<typeof vi.fn>;
  createCDPSession: ReturnType<typeof vi.fn>;
}

const buildMockCDPSession = (): {
  send: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
} => ({
  send: vi.fn().mockResolvedValue(undefined),
  detach: vi.fn().mockResolvedValue(undefined),
});

const buildMockPage = (): MockPage => ({
  setViewport: vi.fn().mockResolvedValue(undefined),
  setUserAgent: vi.fn().mockResolvedValue(undefined),
  setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
  goto: vi.fn().mockResolvedValue({
    status: () => 200,
    statusText: () => "OK",
  }),
  evaluate: vi.fn().mockResolvedValue(undefined),
  addStyleTag: vi.fn().mockResolvedValue(undefined),
  content: vi.fn().mockResolvedValue("<html></html>"),
  screenshot: vi.fn().mockResolvedValue(Buffer.from("scr")),
  pdf: vi.fn().mockResolvedValue(Buffer.from("%PDF-1.4 fake")),
  url: vi.fn().mockReturnValue("https://example.com/"),
  createCDPSession: vi.fn().mockResolvedValue(buildMockCDPSession()),
});

const asPage = (page: MockPage): Page => page as unknown as Page;

const buildTask = (overrides: Partial<CaptureTask> = {}): CaptureTask => ({
  taskId: "test-task-id",
  labels: ["test"],
  url: "https://example.com",
  retryCount: 0,
  captureFormats: { png: true, jpeg: false, html: false, links: false, pdf: false },
  enqueuedAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

describe("PageCapturer.capture — viewport override", () => {
  let store: FakeArtifactStore;

  beforeEach(() => {
    store = createTestArtifactStore("/tmp/out");
  });

  it("uses task.viewport when present (overrides config.viewport)", async () => {
    const config = createTestCaptureConfig({
      viewport: { width: 1280, height: 800 },
    });
    const capturer = new PageCapturer(config, store);
    const page = buildMockPage();

    await capturer.capture(
      asPage(page),
      buildTask({ viewport: { width: 1920, height: 1080 } }),
      0,
    );

    expect(page.setViewport).toHaveBeenCalledTimes(1);
    expect(page.setViewport).toHaveBeenCalledWith({
      width: 1920,
      height: 1080,
    });
  });

  it("falls back to config.viewport when task.viewport is absent", async () => {
    const config = createTestCaptureConfig({
      viewport: { width: 1280, height: 800 },
    });
    const capturer = new PageCapturer(config, store);
    const page = buildMockPage();

    await capturer.capture(asPage(page), buildTask(), 0);

    expect(page.setViewport).toHaveBeenCalledTimes(1);
    expect(page.setViewport).toHaveBeenCalledWith({
      width: 1280,
      height: 800,
    });
  });
});

describe("PageCapturer.capture — fullPage override", () => {
  let store: FakeArtifactStore;

  beforeEach(() => {
    store = createTestArtifactStore("/tmp/out");
  });

  it("uses task.fullPage=true when present (overrides config default false)", async () => {
    const config = createTestCaptureConfig({
      screenshot: { fullPage: false },
    });
    const capturer = new PageCapturer(config, store);
    const page = buildMockPage();

    await capturer.capture(
      asPage(page),
      buildTask({ fullPage: true }),
      0,
    );

    expect(page.screenshot).toHaveBeenCalledTimes(1);
    expect(page.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ fullPage: true, type: "png" }),
    );
  });

  it("uses task.fullPage=false when present (overrides config default true)", async () => {
    const config = createTestCaptureConfig({
      screenshot: { fullPage: true },
    });
    const capturer = new PageCapturer(config, store);
    const page = buildMockPage();

    await capturer.capture(
      asPage(page),
      buildTask({ fullPage: false }),
      0,
    );

    expect(page.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ fullPage: false, type: "png" }),
    );
  });

  it("falls back to config.screenshot.fullPage when task.fullPage is absent", async () => {
    const config = createTestCaptureConfig({
      screenshot: { fullPage: true },
    });
    const capturer = new PageCapturer(config, store);
    const page = buildMockPage();

    await capturer.capture(asPage(page), buildTask(), 0);

    expect(page.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ fullPage: true, type: "png" }),
    );
  });

  it("propagates task.fullPage to JPEG screenshots too", async () => {
    const config = createTestCaptureConfig({
      screenshot: { fullPage: false },
    });
    const capturer = new PageCapturer(config, store);
    const page = buildMockPage();

    await capturer.capture(
      asPage(page),
      buildTask({
        captureFormats: { png: false, jpeg: true, html: false, links: false, pdf: false },
        fullPage: true,
      }),
      0,
    );

    expect(page.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ fullPage: true, type: "jpeg" }),
    );
  });
});
