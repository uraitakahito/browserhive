/**
 * PageCapturer integration test for banner dismissal wiring.
 *
 * Lives in a separate file because `vi.mock` is hoisted per-file and we
 * don't want it to affect the helper-utility tests in page-capturer.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Page } from "puppeteer";
import type { CaptureTask } from "../../src/capture/types.js";
import type { DismissReport } from "../../src/capture/banner-dismisser.js";
import { createTestCaptureConfig } from "../helpers/config.js";

const dismissBannersMock = vi.fn<(page: Page) => Promise<DismissReport>>();

vi.mock("../../src/capture/banner-dismisser.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/capture/banner-dismisser.js")
  >("../../src/capture/banner-dismisser.js");
  return {
    ...actual,
    dismissBanners: (page: Page) => dismissBannersMock(page),
  };
});

// Import after mocking.
import { PageCapturer } from "../../src/capture/page-capturer.js";

interface MockPage {
  setViewport: ReturnType<typeof vi.fn>;
  setUserAgent: ReturnType<typeof vi.fn>;
  setExtraHTTPHeaders: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  addStyleTag: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
  content: ReturnType<typeof vi.fn>;
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
  screenshot: vi.fn().mockResolvedValue(Buffer.from("screenshot")),
  content: vi.fn().mockResolvedValue("<html></html>"),
  createCDPSession: vi.fn().mockResolvedValue(buildMockCDPSession()),
});

const asPage = (page: MockPage): Page => page as unknown as Page;

const buildTask = (overrides: Partial<CaptureTask> = {}): CaptureTask => ({
  taskId: "test-task",
  labels: ["test"],
  url: "https://example.com",
  retryCount: 0,
  captureFormats: { png: false, jpeg: false, html: true, links: false },
  dismissBanners: false,
  enqueuedAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

// Use writeFile mock so the test does not actually touch disk.
vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

describe("PageCapturer.capture — banner dismissal integration", () => {
  beforeEach(() => {
    dismissBannersMock.mockReset();
    dismissBannersMock.mockResolvedValue({
      framework: "OneTrust",
      removedSelectors: ["#onetrust-banner-sdk"],
      removedOverlayCount: 0,
    });
  });

  it("calls dismissBanners and attaches the report when task.dismissBanners is true", async () => {
    const config = createTestCaptureConfig({ outputDir: "/tmp/out" });
    const capturer = new PageCapturer(config);
    const page = buildMockPage();

    const result = await capturer.capture(asPage(page), buildTask({ dismissBanners: true }), 0);

    expect(dismissBannersMock).toHaveBeenCalledTimes(1);
    expect(dismissBannersMock).toHaveBeenCalledWith(page);
    expect(result.dismissReport).toEqual({
      framework: "OneTrust",
      removedSelectors: ["#onetrust-banner-sdk"],
      removedOverlayCount: 0,
    });
  });

  it("does not call dismissBanners when task.dismissBanners is false", async () => {
    const config = createTestCaptureConfig({ outputDir: "/tmp/out" });
    const capturer = new PageCapturer(config);
    const page = buildMockPage();

    const result = await capturer.capture(asPage(page), buildTask({ dismissBanners: false }), 0);

    expect(dismissBannersMock).not.toHaveBeenCalled();
    expect(result.dismissReport).toBeUndefined();
  });

  it("does not call dismissBanners when the page returned an HTTP error", async () => {
    const config = createTestCaptureConfig({ outputDir: "/tmp/out" });
    const capturer = new PageCapturer(config);
    const page = buildMockPage();
    page.goto.mockResolvedValue({
      status: () => 404,
      statusText: () => "Not Found",
    });

    const result = await capturer.capture(asPage(page), buildTask({ dismissBanners: true }), 0);

    expect(dismissBannersMock).not.toHaveBeenCalled();
    expect(result.status).toBe("httpError");
  });
});
