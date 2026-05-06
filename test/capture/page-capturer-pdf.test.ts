/**
 * PageCapturer integration test for PDF rendering wiring.
 *
 * Uses `createTestArtifactStore()` (in-memory FakeArtifactStore) to capture
 * each `put()` call without touching the network. Mirrors the structure of
 * `page-capturer-links.test.ts` — only the PDF-specific assertions differ.
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
  captureFormats: { png: false, jpeg: false, html: false, links: false, pdf: true },
  resetState: DEFAULT_RESET_STATE_OPTIONS,
  enqueuedAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

const findPdfPut = (store: FakeArtifactStore): { filename: string; buffer: Buffer } => {
  const put = store.puts.find((p) => p.filename.endsWith(".pdf"));
  if (!put) throw new Error("expected a .pdf put");
  if (!Buffer.isBuffer(put.body)) {
    throw new Error("expected .pdf body to be a Buffer");
  }
  return { filename: put.filename, buffer: put.body };
};

describe("PageCapturer.capture — PDF rendering", () => {
  let store: FakeArtifactStore;

  beforeEach(() => {
    store = createTestArtifactStore("/tmp/out");
  });

  it("writes a .pdf file when captureFormats.pdf is true", async () => {
    const config = createTestCaptureConfig();
    const capturer = new PageCapturer(config, store);
    const page = buildMockPage();

    const result = await capturer.capture(asPage(page), buildTask(), 0);

    expect(result.pdfLocation).toBe("/tmp/out/test-task-id_test.pdf");
    expect(page.pdf).toHaveBeenCalledTimes(1);
    expect(page.pdf).toHaveBeenCalledWith({
      format: "A4",
      printBackground: true,
    });
    const written = findPdfPut(store);
    expect(written.filename).toBe("test-task-id_test.pdf");
    expect(written.buffer.toString()).toBe("%PDF-1.4 fake");
  });

  it("does not call page.pdf when captureFormats.pdf is false", async () => {
    const config = createTestCaptureConfig();
    const capturer = new PageCapturer(config, store);
    const page = buildMockPage();

    const result = await capturer.capture(
      asPage(page),
      buildTask({
        captureFormats: { png: true, jpeg: false, html: false, links: false, pdf: false },
      }),
      0,
    );

    expect(result.pdfLocation).toBeUndefined();
    expect(page.pdf).not.toHaveBeenCalled();
  });

  it("retries page.pdf once when the first attempt hits a destroyed-context", async () => {
    const config = createTestCaptureConfig();
    const capturer = new PageCapturer(config, store);
    const page = buildMockPage();

    page.pdf
      .mockRejectedValueOnce(new Error("Execution context was destroyed, most likely because of a navigation."))
      .mockResolvedValueOnce(Buffer.from("%PDF-after-retry"));

    // runOnStableContext awaits page.waitForNavigation between retries.
    const waitForNavigationMock = vi.fn().mockResolvedValue(undefined);
    (page as unknown as { waitForNavigation: typeof waitForNavigationMock }).waitForNavigation =
      waitForNavigationMock;

    const result = await capturer.capture(asPage(page), buildTask(), 0);

    expect(page.pdf).toHaveBeenCalledTimes(2);
    expect(waitForNavigationMock).toHaveBeenCalledTimes(1);
    expect(result.pdfLocation).toBe("/tmp/out/test-task-id_test.pdf");
    const written = findPdfPut(store);
    expect(written.buffer.toString()).toBe("%PDF-after-retry");
  });
});
