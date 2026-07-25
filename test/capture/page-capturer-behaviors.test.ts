/**
 * PageCapturer integration test for the behavior wiring.
 *
 * `runBehaviors` is the only capture step that calls `page.waitForNetworkIdle`,
 * so that call is the signal for "the behavior pass ran". runBehaviors returns
 * early (no evaluate / no waitForNetworkIdle) when nothing is enabled. Here we
 * assert the gating: server default enabled set, the per-request override, and
 * the disabled path. The behaviors themselves run in-page (bundled runtime) and
 * are exercised by the e2e suite.
 */
import { describe, it, expect, vi } from "vitest";
import type { Page } from "puppeteer";
import { PageCapturer } from "../../src/capture/page-capturer.js";
import type { CaptureTask } from "../../src/capture/types.js";
import {
  createTestArtifactStore,
  createTestCaptureConfig,
} from "../helpers/config.js";
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

const BEHAVIOR_REPORT = {
  ran: [{ id: "autoscroll", steps: 2, ms: 5 }],
  timedOut: false,
};

const buildMockPage = (): MockPage => ({
  setViewport: vi.fn().mockResolvedValue(undefined),
  setUserAgent: vi.fn().mockResolvedValue(undefined),
  setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
  goto: vi.fn().mockResolvedValue({ status: () => 200, statusText: () => "OK" }),
  // The behavior run is the only evaluate whose arg carries `enabled`; return a
  // report for it so the result-attachment path is exercised, undefined else.
  evaluate: vi.fn().mockImplementation((_fn: unknown, arg?: unknown) => {
    if (arg !== null && typeof arg === "object" && "enabled" in arg) {
      return Promise.resolve(BEHAVIOR_REPORT);
    }
    return Promise.resolve(undefined);
  }),
  addStyleTag: vi.fn().mockResolvedValue(undefined),
  waitForNetworkIdle: vi.fn().mockResolvedValue(undefined),
});

const asPage = (page: MockPage): Page => page as unknown as Page;

// No format work — we only care whether the behavior pass runs.
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

describe("PageCapturer.capture — behavior wiring", () => {
  it("runs the behavior pass when the server default enables built-ins", async () => {
    const config = createTestCaptureConfig({
      behaviors: { builtins: ["autoscroll"] },
    });
    const capturer = new PageCapturer(config, createTestArtifactStore());
    const page = buildMockPage();
    await capturer.capture(asPage(page), buildTask(), 0);
    expect(page.waitForNetworkIdle).toHaveBeenCalledTimes(1);
  });

  it("skips the behavior pass when no built-ins are enabled", async () => {
    // createTestCaptureConfig disables all built-ins by default.
    const capturer = new PageCapturer(createTestCaptureConfig(), createTestArtifactStore());
    const page = buildMockPage();
    await capturer.capture(asPage(page), buildTask(), 0);
    expect(page.waitForNetworkIdle).not.toHaveBeenCalled();
  });

  it("per-request behaviors override enables built-ins over a disabled default", async () => {
    const capturer = new PageCapturer(createTestCaptureConfig(), createTestArtifactStore());
    const page = buildMockPage();
    await capturer.capture(
      asPage(page),
      buildTask({ behaviors: { builtins: ["autoscroll"] } }),
      0,
    );
    expect(page.waitForNetworkIdle).toHaveBeenCalledTimes(1);
  });

  it("per-request empty builtins override disables an enabled default", async () => {
    const config = createTestCaptureConfig({
      behaviors: { builtins: ["autoscroll"] },
    });
    const capturer = new PageCapturer(config, createTestArtifactStore());
    const page = buildMockPage();
    await capturer.capture(asPage(page), buildTask({ behaviors: { builtins: [] } }), 0);
    expect(page.waitForNetworkIdle).not.toHaveBeenCalled();
  });

  it("attaches the behaviorReport to the result when behaviors run", async () => {
    const config = createTestCaptureConfig({
      behaviors: { builtins: ["autoscroll"] },
    });
    const capturer = new PageCapturer(config, createTestArtifactStore());
    const page = buildMockPage();
    const result = await capturer.capture(asPage(page), buildTask(), 0);
    expect(result.behaviorReport).toEqual(BEHAVIOR_REPORT);
  });

  it("omits the behaviorReport when no behaviors run", async () => {
    const capturer = new PageCapturer(createTestCaptureConfig(), createTestArtifactStore());
    const page = buildMockPage();
    const result = await capturer.capture(asPage(page), buildTask(), 0);
    expect(result.behaviorReport).toBeUndefined();
  });
});
