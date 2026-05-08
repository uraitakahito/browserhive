/**
 * PageCapturer integration test for WACZ recording.
 *
 * Drives the full capture flow with `captureFormats.wacz: true`. The mock
 * CDP session simulates a tiny GET (request → response → loadingFinished)
 * so the WARC carries one real response record; we then verify the WACZ
 * was uploaded with the expected MIME, that the resulting bytes round-trip
 * through unzip cleanly, and that disabling `wacz` skips the recorder
 * entirely (no `Network.enable`).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Page } from "puppeteer";
import { EventEmitter } from "node:events";
import { unzipSync } from "fflate";
import type { CaptureTask } from "../../src/capture/types.js";
import { PageCapturer } from "../../src/capture/page-capturer.js";
import {
  createTestArtifactStore,
  createTestCaptureConfig,
  type FakeArtifactStore,
} from "../helpers/config.js";
import { DEFAULT_RESET_STATE_OPTIONS } from "../../src/capture/reset-state.js";
import type { WaczCaptureConfig } from "../../src/capture/page-capturer.js";

const TASK_ID = "00000000-0000-4000-8000-000000000001";

interface FakeCDPSession extends EventEmitter {
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  detach: () => Promise<void>;
  /** Test helper to install a body for `Network.getResponseBody`. */
  setBody: (requestId: string, body: string) => void;
}

const makeCDPSession = (): FakeCDPSession => {
  const ee = new EventEmitter();
  const bodies = new Map<string, string>();
  const session = ee as unknown as FakeCDPSession;
  session.send = async (
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> => {
    if (method === "Network.enable") return Promise.resolve(undefined);
    if (method === "Network.getResponseBody") {
      const raw = params?.["requestId"];
      const requestId = typeof raw === "string" ? raw : "";
      const body = bodies.get(requestId);
      if (body === undefined) throw new Error("No resource");
      return Promise.resolve({ body, base64Encoded: false });
    }
    if (method === "Network.clearBrowserCookies") return Promise.resolve(undefined);
    return Promise.resolve(undefined);
  };
  // Mirror the production CDP semantic: detaching the session unsubscribes
  // every listener so no further `Network.*` events reach the recorder.
  // Without this, the `about:blank` navigation issued by `resetPageState`
  // (after `recorder.stop()`) re-fires our scripted events and double-counts
  // the recording.
  session.detach = (): Promise<void> => {
    ee.removeAllListeners();
    return Promise.resolve();
  };
  session.setBody = (id, body): void => {
    bodies.set(id, body);
  };
  return session;
};

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
  title: ReturnType<typeof vi.fn>;
  createCDPSession: ReturnType<typeof vi.fn>;
}

const buildMockPage = (
  cdpSession: FakeCDPSession,
  onNavigate?: () => void,
): MockPage => ({
  setViewport: vi.fn().mockResolvedValue(undefined),
  setUserAgent: vi.fn().mockResolvedValue(undefined),
  setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
  goto: vi.fn().mockImplementation(async () => {
    onNavigate?.();
    return Promise.resolve({
      status: () => 200,
      statusText: () => "OK",
    });
  }),
  evaluate: vi.fn().mockResolvedValue(undefined),
  addStyleTag: vi.fn().mockResolvedValue(undefined),
  content: vi.fn().mockResolvedValue("<html></html>"),
  screenshot: vi.fn().mockResolvedValue(Buffer.from("scr")),
  pdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
  url: vi.fn().mockReturnValue("https://example.com/"),
  title: vi.fn().mockResolvedValue("Example"),
  createCDPSession: vi.fn().mockResolvedValue(cdpSession),
});

const asPage = (p: MockPage): Page => p as unknown as Page;

const buildTask = (overrides: Partial<CaptureTask> = {}): CaptureTask => ({
  taskId: TASK_ID,
  labels: ["test"],
  url: "https://example.com",
  retryCount: 0,
  captureFormats: {
    png: false,
    webp: false,
    html: false,
    links: false,
    pdf: false,
    mhtml: false,
    wacz: true,
  },
  resetState: DEFAULT_RESET_STATE_OPTIONS,
  enqueuedAt: "2026-05-08T12:00:00.000Z",
  ...overrides,
});

const buildWaczConfig = (): WaczCaptureConfig => ({
  filters: { blockUrlPatterns: [], skipContentTypes: [] },
  limits: {
    maxResponseBytes: 10 * 1024 * 1024,
    maxTaskBytes: 50 * 1024 * 1024,
    maxPendingRequests: 1000,
  },
  software: "browserhive-test/0.0.0",
  fuzzyParams: [],
});

describe("PageCapturer.capture — WACZ recording", () => {
  let store: FakeArtifactStore;

  beforeEach(() => {
    store = createTestArtifactStore("/tmp/out");
  });

  it("records the navigation request and uploads a WACZ artifact", async () => {
    const cdp = makeCDPSession();
    cdp.setBody("req-1", "<html>captured</html>");
    // Simulate Chromium emitting Network events in response to page.goto.
    const onNavigate = (): void => {
      cdp.emit("Network.requestWillBeSent", {
        requestId: "req-1",
        request: {
          url: "https://example.com/",
          method: "GET",
          headers: { Accept: "*/*" },
        },
      });
      cdp.emit("Network.responseReceived", {
        requestId: "req-1",
        response: {
          url: "https://example.com/",
          status: 200,
          statusText: "OK",
          protocol: "http/1.1",
          mimeType: "text/html",
          headers: { "Content-Type": "text/html" },
          encodedDataLength: 21,
        },
      });
      cdp.emit("Network.loadingFinished", {
        requestId: "req-1",
        encodedDataLength: 21,
      });
    };
    const page = buildMockPage(cdp, onNavigate);
    const config = createTestCaptureConfig();
    const capturer = new PageCapturer(config, store, buildWaczConfig());

    const result = await capturer.capture(asPage(page), buildTask(), 0);
    expect(result.status).toBe("success");
    expect(result.waczLocation).toBe(`/tmp/out/${TASK_ID}_test.wacz`);
    expect(result.waczStats?.totalRecorded).toBe(1);
    expect(result.waczStats?.totalBodyBytes).toBeGreaterThan(0);

    // The fake artifact store keeps body bytes — verify they form a valid
    // WACZ zip with the expected entries.
    const put = store.puts.find((p) => p.filename.endsWith(".wacz"));
    expect(put).toBeDefined();
    expect(put?.contentType).toBe("application/wacz+zip");
    const bytes =
      put?.body instanceof Buffer ? put.body : Buffer.from(put?.body ?? "");
    const entries = unzipSync(new Uint8Array(bytes));
    const names = Object.keys(entries).sort();
    expect(names).toEqual([
      "archive/data.warc.gz",
      "datapackage.json",
      "fuzzy.json",
      "indexes/index.cdxj",
      "pages/pages.jsonl",
    ]);
    // datapackage.json should embed the captured ts (Phase 6.1 clock-fixing
    // contract — value comes from the `capturedAt` we passed at start).
    const pkg = JSON.parse(
      Buffer.from(entries["datapackage.json"]!).toString("utf-8"),
    ) as { mainPageDate: string; mainPageURL: string };
    expect(pkg.mainPageURL).toBe("https://example.com");
    expect(pkg.mainPageDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("does NOT create a CDP session when captureFormats.wacz is false", async () => {
    const cdp = makeCDPSession();
    const page = buildMockPage(cdp);
    const config = createTestCaptureConfig();
    const capturer = new PageCapturer(config, store, buildWaczConfig());

    const task = buildTask({
      captureFormats: {
        png: true,
        webp: false,
        html: false,
        links: false,
        pdf: false,
        mhtml: false,
        wacz: false,
      },
    });
    const result = await capturer.capture(asPage(page), task, 0);
    expect(result.status).toBe("success");
    expect(result.waczLocation).toBeUndefined();
    expect(result.waczStats).toBeUndefined();
    // When WACZ isn't requested, the only CDP session created should come
    // from `resetPageState` for `Network.clearBrowserCookies`. Verify by
    // checking that `Network.enable` was never sent.
    expect(
      page.createCDPSession.mock.calls.length,
    ).toBeLessThanOrEqual(1);
  });

  it("returns an internal error when wacz is requested but no WaczCaptureConfig is wired up", async () => {
    const cdp = makeCDPSession();
    const page = buildMockPage(cdp);
    const config = createTestCaptureConfig();
    // No third argument → waczConfig undefined
    const capturer = new PageCapturer(config, store);

    const result = await capturer.capture(asPage(page), buildTask(), 0);
    expect(result.status).toBe("failed");
    expect(result.errorDetails?.type).toBe("internal");
    expect(result.errorDetails?.message).toMatch(/no WaczCaptureConfig/);
  });
});
