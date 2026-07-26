import { describe, it, expect, vi, afterEach } from "vitest";
import type { Page } from "puppeteer";
import { withOperationDelay } from "../../src/capture/capture-page.js";

interface MockPage {
  goto: ReturnType<typeof vi.fn>;
  content: ReturnType<typeof vi.fn>;
  url: ReturnType<typeof vi.fn>;
}

const buildMockPage = (): MockPage => ({
  goto: vi.fn().mockResolvedValue(null),
  content: vi.fn().mockResolvedValue("<html></html>"),
  url: vi.fn().mockReturnValue("https://example.com/"),
});

const asPage = (page: MockPage): Page => page as unknown as Page;

describe("withOperationDelay", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the raw page when the delay is zero (no wrapper on the normal path)", () => {
    const page = buildMockPage();
    expect(withOperationDelay(asPage(page), 0)).toBe(page);
  });

  it("returns the raw page for a negative delay too", () => {
    const page = buildMockPage();
    expect(withOperationDelay(asPage(page), -1)).toBe(page);
  });

  it("waits before issuing an async operation, not after", async () => {
    vi.useFakeTimers();
    const page = buildMockPage();
    const paced = withOperationDelay(asPage(page), 500);

    const pending = paced.goto("https://example.com/");
    // The delay comes first: the operation must not have been issued yet.
    expect(page.goto).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    await pending;

    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledWith("https://example.com/");
  });

  it("delays each operation separately", async () => {
    vi.useFakeTimers();
    const page = buildMockPage();
    const paced = withOperationDelay(asPage(page), 100);

    const first = paced.content();
    await vi.advanceTimersByTimeAsync(100);
    await first;
    expect(page.content).toHaveBeenCalledTimes(1);

    const second = paced.content();
    expect(page.content).toHaveBeenCalledTimes(1); // still waiting
    await vi.advanceTimersByTimeAsync(100);
    await second;
    expect(page.content).toHaveBeenCalledTimes(2);
  });

  it("passes the operation's result through", async () => {
    const page = buildMockPage();
    const paced = withOperationDelay(asPage(page), 1);

    await expect(paced.content()).resolves.toBe("<html></html>");
  });

  it("leaves the synchronous url() alone — it must not become a promise", () => {
    const paced = withOperationDelay(asPage(buildMockPage()), 500);

    expect(paced.url()).toBe("https://example.com/");
  });
});
