/**
 * PageCapturer integration test for MHTML rendering wiring.
 *
 * Mirrors `page-capturer-pdf.test.ts`. Uses `createTestArtifactStore()`
 * (in-memory FakeArtifactStore) to capture each `put()` call without
 * touching the network. The MHTML path differs from PDF in that it goes
 * through a CDP session rather than a high-level Puppeteer Page method,
 * so the mock CDP session's `send` is the assertion target instead of
 * `page.pdf`.
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

interface MockCDPSession {
  send: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
}

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
  /** Set on demand by tests that exercise the destroyed-context retry path. */
  waitForNavigation?: ReturnType<typeof vi.fn>;
}

const FAKE_MHTML = [
  "From: <Saved by Blink>",
  "Subject: =?utf-8?Q?Example?=",
  "MIME-Version: 1.0",
  'Content-Type: multipart/related; boundary="----MultipartBoundary"',
  "",
  "------MultipartBoundary",
  "Content-Type: text/html",
  "",
  "<html><body>fake</body></html>",
  "------MultipartBoundary--",
  "",
].join("\r\n");

/**
 * Build a CDP session mock that returns a synthetic `Page.captureSnapshot`
 * payload. Other CDP methods (`Network.clearBrowserCookies` from
 * `resetPageState`) are not exercised by these tests, so the default
 * resolves to undefined.
 */
const buildMockCDPSession = (
  snapshot: string = FAKE_MHTML,
): MockCDPSession => ({
  send: vi.fn().mockImplementation((method: string) => {
    if (method === "Page.captureSnapshot") {
      return Promise.resolve({ data: snapshot });
    }
    return Promise.resolve(undefined);
  }),
  detach: vi.fn().mockResolvedValue(undefined),
});

const buildMockPage = (
  cdpSession: MockCDPSession = buildMockCDPSession(),
): MockPage => ({
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
  createCDPSession: vi.fn().mockResolvedValue(cdpSession),
});

const asPage = (page: MockPage): Page => page as unknown as Page;

const buildTask = (overrides: Partial<CaptureTask> = {}): CaptureTask => ({
  taskId: "test-task-id",
  labels: ["test"],
  url: "https://example.com",
  retryCount: 0,
  captureFormats: { png: false, webp: false, html: false, links: false, pdf: false, mhtml: true },
  resetState: DEFAULT_RESET_STATE_OPTIONS,
  enqueuedAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

const findMhtmlPut = (
  store: FakeArtifactStore,
): { filename: string; body: string; contentType: string } => {
  const put = store.puts.find((p) => p.filename.endsWith(".mhtml"));
  if (!put) throw new Error("expected a .mhtml put");
  if (typeof put.body !== "string") {
    throw new Error("expected .mhtml body to be a string");
  }
  return { filename: put.filename, body: put.body, contentType: put.contentType };
};

describe("PageCapturer.capture — MHTML rendering", () => {
  let store: FakeArtifactStore;

  beforeEach(() => {
    store = createTestArtifactStore("/tmp/out");
  });

  it("writes a .mhtml file with multipart/related content type when captureFormats.mhtml is true", async () => {
    const config = createTestCaptureConfig();
    const capturer = new PageCapturer(config, store);
    const cdpSession = buildMockCDPSession();
    const page = buildMockPage(cdpSession);

    const result = await capturer.capture(asPage(page), buildTask(), 0);

    expect(result.mhtmlLocation).toBe("/tmp/out/test-task-id_test.mhtml");
    // Two CDP sessions are opened: one for the MHTML capture and one for
    // resetPageState's `Network.clearBrowserCookies` (the default reset
    // policy). The captureSnapshot call should land on the first one.
    expect(page.createCDPSession).toHaveBeenCalled();
    const captureSnapshotCall = cdpSession.send.mock.calls.find(
      (call) => call[0] === "Page.captureSnapshot",
    );
    expect(captureSnapshotCall).toBeDefined();
    expect(captureSnapshotCall?.[1]).toEqual({ format: "mhtml" });

    const written = findMhtmlPut(store);
    expect(written.filename).toBe("test-task-id_test.mhtml");
    expect(written.body).toBe(FAKE_MHTML);
    expect(written.contentType).toBe("multipart/related");
  });

  it("does not call Page.captureSnapshot when captureFormats.mhtml is false", async () => {
    const config = createTestCaptureConfig();
    const capturer = new PageCapturer(config, store);
    const cdpSession = buildMockCDPSession();
    const page = buildMockPage(cdpSession);

    const result = await capturer.capture(
      asPage(page),
      buildTask({
        captureFormats: { png: true, webp: false, html: false, links: false, pdf: false, mhtml: false },
      }),
      0,
    );

    expect(result.mhtmlLocation).toBeUndefined();
    const snapshotCalls = cdpSession.send.mock.calls.filter(
      (call) => call[0] === "Page.captureSnapshot",
    );
    expect(snapshotCalls).toHaveLength(0);
  });

  it("retries Page.captureSnapshot once when the first attempt hits a destroyed-context", async () => {
    const config = createTestCaptureConfig();
    const capturer = new PageCapturer(config, store);

    const cdpSession: MockCDPSession = {
      send: vi.fn().mockImplementation((method: string) => {
        if (method !== "Page.captureSnapshot") {
          return Promise.resolve(undefined);
        }
        const firstCall = cdpSession.send.mock.calls.filter(
          (c) => c[0] === "Page.captureSnapshot",
        ).length;
        if (firstCall === 1) {
          return Promise.reject(
            new Error(
              "Execution context was destroyed, most likely because of a navigation.",
            ),
          );
        }
        return Promise.resolve({ data: "MHTML-after-retry" });
      }),
      detach: vi.fn().mockResolvedValue(undefined),
    };
    const page = buildMockPage(cdpSession);
    page.waitForNavigation = vi.fn().mockResolvedValue(undefined);

    const result = await capturer.capture(asPage(page), buildTask(), 0);

    const snapshotCalls = cdpSession.send.mock.calls.filter(
      (c) => c[0] === "Page.captureSnapshot",
    );
    expect(snapshotCalls).toHaveLength(2);
    expect(page.waitForNavigation).toHaveBeenCalledTimes(1);
    expect(result.mhtmlLocation).toBe("/tmp/out/test-task-id_test.mhtml");
    const written = findMhtmlPut(store);
    expect(written.body).toBe("MHTML-after-retry");
  });

  it("detaches the CDP session even when capture succeeds", async () => {
    const config = createTestCaptureConfig();
    const capturer = new PageCapturer(config, store);
    const cdpSession = buildMockCDPSession();
    const page = buildMockPage(cdpSession);

    await capturer.capture(asPage(page), buildTask(), 0);

    expect(cdpSession.detach).toHaveBeenCalled();
  });
});
