/**
 * PageCapturer integration test for link extraction wiring.
 *
 * Uses `createTestArtifactStore()` (in-memory FakeArtifactStore) to capture
 * each `put()` call without touching the network. Server-side filtering
 * (http(s) only, dedupe by href) is exercised here; the in-page text trim /
 * rel handling is browser-side and intentionally out of scope.
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
  evaluate: vi.fn(),
  addStyleTag: vi.fn().mockResolvedValue(undefined),
  content: vi.fn().mockResolvedValue("<html></html>"),
  screenshot: vi.fn().mockResolvedValue(Buffer.from("scr")),
  url: vi.fn().mockReturnValue("https://example.com/landing"),
  createCDPSession: vi.fn().mockResolvedValue(buildMockCDPSession()),
});

const asPage = (page: MockPage): Page => page as unknown as Page;

const buildTask = (overrides: Partial<CaptureTask> = {}): CaptureTask => ({
  taskId: "test-task-id",
  labels: ["test"],
  url: "https://example.com",
  retryCount: 0,
  captureFormats: { png: false, jpeg: false, html: false, links: true, pdf: false },
  resetState: DEFAULT_RESET_STATE_OPTIONS,
  enqueuedAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

interface WrittenLinkRecord {
  href: string;
  text: string;
  rel: string | null;
}

interface WrittenLinksFile {
  taskId: string;
  url: string;
  finalUrl: string;
  labels: string[];
  correlationId?: string;
  capturedAt: string;
  links: WrittenLinkRecord[];
}

const findLinksWrite = (store: FakeArtifactStore): WrittenLinksFile => {
  const put = store.puts.find((p) => p.filename.endsWith(".links.json"));
  if (!put) throw new Error("expected a .links.json put");
  if (typeof put.body !== "string") {
    throw new Error("expected .links.json body to be a string");
  }
  return JSON.parse(put.body) as WrittenLinksFile;
};

describe("PageCapturer.capture — link extraction", () => {
  let store: FakeArtifactStore;

  beforeEach(() => {
    store = createTestArtifactStore("/tmp/out");
  });

  it("writes a .links.json file with the extracted links", async () => {
    const config = createTestCaptureConfig();
    const capturer = new PageCapturer(config, store);
    const page = buildMockPage();
    page.evaluate
      .mockResolvedValueOnce(undefined) // dynamic-content wait
      .mockResolvedValueOnce([
        { href: "https://example.com/a", text: "About", rel: null },
        { href: "https://example.com/b", text: "Help", rel: "nofollow" },
      ]);

    const result = await capturer.capture(asPage(page), buildTask(), 0);

    expect(result.linksLocation).toBe("/tmp/out/test-task-id_test.links.json");
    const written = findLinksWrite(store);
    expect(written).toMatchObject({
      taskId: "test-task-id",
      url: "https://example.com",
      finalUrl: "https://example.com/landing",
      labels: ["test"],
      links: [
        { href: "https://example.com/a", text: "About", rel: null },
        { href: "https://example.com/b", text: "Help", rel: "nofollow" },
      ],
    });
    expect(written.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("filters out non-http(s) schemes (mailto:, javascript:, tel:)", async () => {
    const config = createTestCaptureConfig();
    const capturer = new PageCapturer(config, store);
    const page = buildMockPage();
    page.evaluate
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([
        { href: "https://example.com/keep", text: "Keep", rel: null },
        { href: "mailto:foo@example.com", text: "Mail", rel: null },
        { href: "javascript:void(0)", text: "JS", rel: null },
        { href: "tel:+81-3-1234-5678", text: "Tel", rel: null },
        { href: "http://example.com/insecure", text: "Insecure", rel: null },
      ]);

    await capturer.capture(asPage(page), buildTask(), 0);

    const written = findLinksWrite(store);
    expect(written.links.map((l) => l.href)).toEqual([
      "https://example.com/keep",
      "http://example.com/insecure",
    ]);
  });

  it("dedupes by href, keeping the first occurrence", async () => {
    const config = createTestCaptureConfig();
    const capturer = new PageCapturer(config, store);
    const page = buildMockPage();
    page.evaluate
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([
        { href: "https://example.com/a", text: "First", rel: null },
        { href: "https://example.com/b", text: "Other", rel: null },
        { href: "https://example.com/a", text: "Second", rel: "nofollow" },
      ]);

    await capturer.capture(asPage(page), buildTask(), 0);

    const written = findLinksWrite(store);
    expect(written.links).toEqual([
      { href: "https://example.com/a", text: "First", rel: null },
      { href: "https://example.com/b", text: "Other", rel: null },
    ]);
  });

  it("drops malformed URLs that the URL constructor rejects", async () => {
    const config = createTestCaptureConfig();
    const capturer = new PageCapturer(config, store);
    const page = buildMockPage();
    page.evaluate
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([
        { href: "https://example.com/ok", text: "OK", rel: null },
        { href: "not a url", text: "Bad", rel: null },
        { href: "", text: "Empty", rel: null },
      ]);

    await capturer.capture(asPage(page), buildTask(), 0);

    const written = findLinksWrite(store);
    expect(written.links.map((l) => l.href)).toEqual([
      "https://example.com/ok",
    ]);
  });

  it("writes an empty links array when the page has no anchors", async () => {
    const config = createTestCaptureConfig();
    const capturer = new PageCapturer(config, store);
    const page = buildMockPage();
    page.evaluate
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([]);

    const result = await capturer.capture(asPage(page), buildTask(), 0);

    expect(result.linksLocation).toBe("/tmp/out/test-task-id_test.links.json");
    expect(findLinksWrite(store).links).toEqual([]);
  });

  it("does not extract links when captureFormats.links is false", async () => {
    const config = createTestCaptureConfig();
    const capturer = new PageCapturer(config, store);
    const page = buildMockPage();
    page.evaluate.mockResolvedValueOnce(undefined); // dynamic-content wait only

    const result = await capturer.capture(
      asPage(page),
      buildTask({
        captureFormats: { png: false, jpeg: false, html: true, links: false, pdf: false },
      }),
      0,
    );

    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(result.linksLocation).toBeUndefined();
    const linksPut = store.puts.find((p) => p.filename.endsWith(".links.json"));
    expect(linksPut).toBeUndefined();
  });

  it("includes correlationId in the file payload when present on the task", async () => {
    const config = createTestCaptureConfig();
    const capturer = new PageCapturer(config, store);
    const page = buildMockPage();
    page.evaluate
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([
        { href: "https://example.com/a", text: "A", rel: null },
      ]);

    await capturer.capture(
      asPage(page),
      buildTask({ correlationId: "ext-42" }),
      0,
    );

    expect(findLinksWrite(store).correlationId).toBe("ext-42");
  });
});
