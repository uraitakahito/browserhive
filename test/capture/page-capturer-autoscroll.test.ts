/**
 * PageCapturer integration test for the auto-scroll wiring.
 *
 * `autoScroll` is the only step that calls `page.waitForNetworkIdle`, so we
 * use that call as the signal for "the scroll pass ran". The scroll loop
 * itself is covered by auto-scroll.test.ts; here we only assert the gating:
 * server default, the per-request override, and the disabled path.
 */
import { describe, it, expect, vi } from "vitest";
import type { Page } from "puppeteer";
import { PageCapturer } from "../../src/capture/page-capturer.js";
import type { CaptureTask } from "../../src/capture/types.js";
import { createTestArtifactStore, createTestCaptureConfig } from "../helpers/config.js";
import { DEFAULT_RESET_STATE_OPTIONS } from "../../src/capture/reset-state.js";

interface MockPage {
  setViewport: ReturnType<typeof vi.fn>;
  setUserAgent: ReturnType<typeof vi.fn>;
  setExtraHTTPHeaders: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  addStyleTag: ReturnType<typeof vi.fn>;
  waitForNetworkIdle: ReturnType<typeof vi.fn>;
}

const buildMockPage = (): MockPage => ({
  setViewport: vi.fn().mockResolvedValue(undefined),
  setUserAgent: vi.fn().mockResolvedValue(undefined),
  setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
  goto: vi.fn().mockResolvedValue({ status: () => 200, statusText: () => "OK" }),
  evaluate: vi.fn().mockResolvedValue(undefined),
  addStyleTag: vi.fn().mockResolvedValue(undefined),
  waitForNetworkIdle: vi.fn().mockResolvedValue(undefined),
});

const asPage = (page: MockPage): Page => page as unknown as Page;

// No format work — we only care whether the autoScroll pass runs.
const buildTask = (overrides: Partial<CaptureTask> = {}): CaptureTask => ({
  taskId: "test-task",
  labels: ["test"],
  url: "https://example.com",
  retryCount: 0,
  captureFormats: { png: false, webp: false, html: false, links: false, mhtml: false, wacz: false },
  resetState: DEFAULT_RESET_STATE_OPTIONS,
  enqueuedAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

describe("PageCapturer.capture — autoScroll wiring", () => {
  it("runs the scroll pass when the server default enables autoScroll", async () => {
    const config = createTestCaptureConfig({ autoScroll: { enabled: true } });
    const capturer = new PageCapturer(config, createTestArtifactStore());
    const page = buildMockPage();
    await capturer.capture(asPage(page), buildTask(), 0);
    expect(page.waitForNetworkIdle).toHaveBeenCalledTimes(1);
  });

  it("skips the scroll pass when autoScroll is disabled", async () => {
    // createTestCaptureConfig disables autoScroll by default.
    const capturer = new PageCapturer(createTestCaptureConfig(), createTestArtifactStore());
    const page = buildMockPage();
    await capturer.capture(asPage(page), buildTask(), 0);
    expect(page.waitForNetworkIdle).not.toHaveBeenCalled();
  });

  it("per-request task.autoScroll=true overrides a disabled server default", async () => {
    const capturer = new PageCapturer(createTestCaptureConfig(), createTestArtifactStore());
    const page = buildMockPage();
    await capturer.capture(asPage(page), buildTask({ autoScroll: true }), 0);
    expect(page.waitForNetworkIdle).toHaveBeenCalledTimes(1);
  });

  it("per-request task.autoScroll=false overrides an enabled server default", async () => {
    const config = createTestCaptureConfig({ autoScroll: { enabled: true } });
    const capturer = new PageCapturer(config, createTestArtifactStore());
    const page = buildMockPage();
    await capturer.capture(asPage(page), buildTask({ autoScroll: false }), 0);
    expect(page.waitForNetworkIdle).not.toHaveBeenCalled();
  });
});
