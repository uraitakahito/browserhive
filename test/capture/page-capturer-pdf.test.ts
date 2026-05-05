/**
 * PageCapturer integration test for PDF rendering wiring.
 *
 * Mocks `node:fs/promises.writeFile` so the test does not touch disk,
 * and stubs `page.pdf` to return a synthetic byte buffer. Mirrors the
 * structure of `page-capturer-links.test.ts` — only the PDF-specific
 * assertions differ.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Page } from "puppeteer";
import type { CaptureTask } from "../../src/capture/types.js";
import { createTestCaptureConfig } from "../helpers/config.js";

const writeFileMock =
  vi.fn<
    (path: string, content: string | Buffer, encoding?: string) => Promise<void>
  >();
vi.mock("node:fs/promises", () => ({
  writeFile: (
    path: string,
    content: string | Buffer,
    encoding?: string,
  ): Promise<void> => writeFileMock(path, content, encoding),
}));

// Import after mocking.
import { PageCapturer } from "../../src/capture/page-capturer.js";
import { LocalArtifactStore } from "../../src/storage/index.js";

const buildStore = (outputDir: string): LocalArtifactStore =>
  new LocalArtifactStore(outputDir);

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
  enqueuedAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

const findPdfWrite = (): { path: string; buffer: Buffer } => {
  const call = writeFileMock.mock.calls.find(
    ([path]: unknown[]) => typeof path === "string" && path.endsWith(".pdf"),
  );
  if (!call) throw new Error("expected a .pdf writeFile call");
  return { path: call[0], buffer: call[1] as Buffer };
};

describe("PageCapturer.capture — PDF rendering", () => {
  beforeEach(() => {
    writeFileMock.mockReset();
    writeFileMock.mockResolvedValue(undefined);
  });

  it("writes a .pdf file when captureFormats.pdf is true", async () => {
    const config = createTestCaptureConfig({ outputDir: "/tmp/out" });
    const capturer = new PageCapturer(config, buildStore("/tmp/out"));
    const page = buildMockPage();

    const result = await capturer.capture(asPage(page), buildTask(), 0);

    expect(result.pdfLocation).toBe("/tmp/out/test-task-id_test.pdf");
    expect(page.pdf).toHaveBeenCalledTimes(1);
    expect(page.pdf).toHaveBeenCalledWith({
      format: "A4",
      printBackground: true,
    });
    const written = findPdfWrite();
    expect(written.path).toBe("/tmp/out/test-task-id_test.pdf");
    expect(written.buffer.toString()).toBe("%PDF-1.4 fake");
  });

  it("does not call page.pdf when captureFormats.pdf is false", async () => {
    const config = createTestCaptureConfig({ outputDir: "/tmp/out" });
    const capturer = new PageCapturer(config, buildStore("/tmp/out"));
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
    const config = createTestCaptureConfig({ outputDir: "/tmp/out" });
    const capturer = new PageCapturer(config, buildStore("/tmp/out"));
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
    const written = findPdfWrite();
    expect(written.buffer.toString()).toBe("%PDF-after-retry");
  });
});
