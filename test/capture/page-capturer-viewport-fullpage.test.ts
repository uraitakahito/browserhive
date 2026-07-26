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
 * Uses a mock page that records each puppeteer-level call.
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
import { DEFAULT_RESET_STATE_OPTIONS } from "../../src/capture/reset-state.js";

interface MockPage {
  setViewport: ReturnType<typeof vi.fn>;
  setCacheEnabled: ReturnType<typeof vi.fn>;
  setUserAgent: ReturnType<typeof vi.fn>;
  setExtraHTTPHeaders: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  addStyleTag: ReturnType<typeof vi.fn>;
  content: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
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
  setCacheEnabled: vi.fn().mockResolvedValue(undefined),
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
  url: vi.fn().mockReturnValue("https://example.com/"),
  createCDPSession: vi.fn().mockResolvedValue(buildMockCDPSession()),
});

const asPage = (page: MockPage): Page => page as unknown as Page;

/**
 * Navigations to the capture target. `page.goto` also serves the post-capture
 * `about:blank` reset, which would otherwise inflate the count.
 */
const gotoTargetCount = (page: MockPage): number =>
  page.goto.mock.calls.filter(
    ([url]: [string]) => !url.startsWith("about:"),
  ).length;

const buildTask = (overrides: Partial<CaptureTask> = {}): CaptureTask => ({
  taskId: "test-task-id",
  labels: ["test"],
  url: "https://example.com",
  retryCount: 0,
  captureFormats: { png: true, webp: false, html: false, links: false, mhtml: false, wacz: false },
  resetState: DEFAULT_RESET_STATE_OPTIONS,
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
      deviceScaleFactor: 1,
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
      deviceScaleFactor: 1,
    });
  });

  it("uses task.deviceScaleFactor when present (overrides config DPR)", async () => {
    const config = createTestCaptureConfig({
      viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    });
    const capturer = new PageCapturer(config, store);
    const page = buildMockPage();

    await capturer.capture(
      asPage(page),
      buildTask({ deviceScaleFactor: 2 }),
      0,
    );

    expect(page.setViewport).toHaveBeenCalledWith({
      width: 1280,
      height: 800,
      deviceScaleFactor: 2,
    });
  });

  it("falls back to config.viewport.deviceScaleFactor when task DPR is absent", async () => {
    const config = createTestCaptureConfig({
      viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    });
    const capturer = new PageCapturer(config, store);
    const page = buildMockPage();

    await capturer.capture(asPage(page), buildTask(), 0);

    expect(page.setViewport).toHaveBeenCalledWith({
      width: 1280,
      height: 800,
      deviceScaleFactor: 2,
    });
  });
});

describe("PageCapturer.capture — archiveMode", () => {
  let store: FakeArtifactStore;

  beforeEach(() => {
    store = createTestArtifactStore("/tmp/out");
  });

  it("single-pass loads the page once, with the browser cache left on", async () => {
    const capturer = new PageCapturer(createTestCaptureConfig(), store);
    const page = buildMockPage();

    await capturer.capture(asPage(page), buildTask(), 0);

    // `page.goto` is also used for the post-capture about:blank reset, so count
    // only the navigations to the target URL.
    expect(gotoTargetCount(page)).toBe(1);
    expect(page.setViewport).toHaveBeenCalledTimes(1);
    expect(page.setCacheEnabled).toHaveBeenCalledWith(true);
  });

  it("multipass loads the page once per DPR (1 then 2) with the cache disabled", async () => {
    const config = createTestCaptureConfig({
      viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    });
    const capturer = new PageCapturer(config, store);
    const page = buildMockPage();

    await capturer.capture(
      asPage(page),
      buildTask({ archiveMode: "multipass" }),
      0,
    );

    expect(page.setCacheEnabled).toHaveBeenCalledWith(false);
    expect(gotoTargetCount(page)).toBe(2);
    expect(page.setViewport).toHaveBeenNthCalledWith(1, {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
    });
    expect(page.setViewport).toHaveBeenNthCalledWith(2, {
      width: 1280,
      height: 800,
      deviceScaleFactor: 2,
    });
  });

  it("multipass ignores task.deviceScaleFactor (the mode sweeps its own DPRs)", async () => {
    const capturer = new PageCapturer(createTestCaptureConfig(), store);
    const page = buildMockPage();

    await capturer.capture(
      asPage(page),
      buildTask({ archiveMode: "multipass", deviceScaleFactor: 3 }),
      0,
    );

    const ratios = page.setViewport.mock.calls.map(
      ([viewport]: [{ deviceScaleFactor: number }]) => viewport.deviceScaleFactor,
    );
    expect(ratios).toEqual([1, 2]);
  });

  it("captures screenshots once, from the state left by the last pass", async () => {
    const capturer = new PageCapturer(createTestCaptureConfig(), store);
    const page = buildMockPage();

    await capturer.capture(
      asPage(page),
      buildTask({ archiveMode: "multipass" }),
      0,
    );

    expect(page.screenshot).toHaveBeenCalledTimes(1);
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

  it("propagates task.fullPage to WebP screenshots too", async () => {
    const config = createTestCaptureConfig({
      screenshot: { fullPage: false },
    });
    const capturer = new PageCapturer(config, store);
    const page = buildMockPage();

    await capturer.capture(
      asPage(page),
      buildTask({
        captureFormats: { png: false, webp: true, html: false, links: false, mhtml: false, wacz: false },
        fullPage: true,
      }),
      0,
    );

    expect(page.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ fullPage: true, type: "webp" }),
    );
  });
});
