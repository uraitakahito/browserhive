import { describe, it, expect } from "vitest";
import {
  DEFAULT_CAPTURE_CONFIG,
  DEFAULT_WORKER_CONFIG,
  DEFAULT_SERVER_CONFIG,
} from "../../src/config/index.js";
import {
  createTestCaptureConfig,
  createTestWorkerConfig,
  createTestServerConfig,
} from "../helpers/config.js";

describe("DEFAULT_CAPTURE_CONFIG", () => {
  it("should have correct default values", () => {
    // outputDir is empty because it's a required CLI option
    expect(DEFAULT_CAPTURE_CONFIG.outputDir).toBe("");
    expect(DEFAULT_CAPTURE_CONFIG.timeouts.pageLoad).toBe(30000);
    expect(DEFAULT_CAPTURE_CONFIG.timeouts.capture).toBe(10000);
    expect(DEFAULT_CAPTURE_CONFIG.maxRetries).toBe(2);
    expect(DEFAULT_CAPTURE_CONFIG.viewport.width).toBe(1280);
    expect(DEFAULT_CAPTURE_CONFIG.viewport.height).toBe(800);
    expect(DEFAULT_CAPTURE_CONFIG.screenshot.fullPage).toBe(false);
    expect(DEFAULT_CAPTURE_CONFIG.userAgent).toBeUndefined();
  });
});

describe("DEFAULT_WORKER_CONFIG", () => {
  it("should have empty browsers by default", () => {
    expect(DEFAULT_WORKER_CONFIG.browsers).toEqual([]);
  });

  it("should contain DEFAULT_CAPTURE_CONFIG", () => {
    expect(DEFAULT_WORKER_CONFIG.capture).toEqual(DEFAULT_CAPTURE_CONFIG);
  });
});

describe("DEFAULT_SERVER_CONFIG", () => {
  it("should have correct default port", () => {
    expect(DEFAULT_SERVER_CONFIG.port).toBe(50051);
  });

  it("should contain DEFAULT_WORKER_CONFIG", () => {
    expect(DEFAULT_SERVER_CONFIG.worker).toEqual(DEFAULT_WORKER_CONFIG);
  });
});

describe("createTestCaptureConfig", () => {
  it("should return default config when no overrides", () => {
    const config = createTestCaptureConfig();
    expect(config).toEqual(DEFAULT_CAPTURE_CONFIG);
  });

  it("should override top-level properties", () => {
    const config = createTestCaptureConfig({
      outputDir: "/custom/output",
      maxRetries: 5,
    });

    expect(config.outputDir).toBe("/custom/output");
    expect(config.maxRetries).toBe(5);
    expect(config.timeouts).toEqual(DEFAULT_CAPTURE_CONFIG.timeouts);
  });

  it("should override nested timeouts", () => {
    const config = createTestCaptureConfig({
      timeouts: { pageLoad: 60000, capture: 20000 },
    });

    expect(config.timeouts.pageLoad).toBe(60000);
    expect(config.timeouts.capture).toBe(20000);
  });

  it("should override nested viewport", () => {
    const config = createTestCaptureConfig({
      viewport: { width: 1920, height: 1080 },
    });

    expect(config.viewport.width).toBe(1920);
    expect(config.viewport.height).toBe(1080);
  });

  it("should override nested screenshot options", () => {
    const config = createTestCaptureConfig({
      screenshot: { fullPage: true, quality: 80 },
    });

    expect(config.screenshot.fullPage).toBe(true);
    expect(config.screenshot.quality).toBe(80);
  });

  it("should override userAgent", () => {
    const config = createTestCaptureConfig({
      userAgent: "Custom User-Agent",
    });

    expect(config.userAgent).toBe("Custom User-Agent");
  });

  it("should not modify default config", () => {
    const originalTimeout = DEFAULT_CAPTURE_CONFIG.timeouts.pageLoad;

    createTestCaptureConfig({
      timeouts: { pageLoad: 60000, capture: 20000 },
    });

    expect(DEFAULT_CAPTURE_CONFIG.timeouts.pageLoad).toBe(originalTimeout);
  });
});

describe("createTestWorkerConfig", () => {
  it("should return default config when no overrides", () => {
    const config = createTestWorkerConfig();
    expect(config.browsers).toEqual([]);
    expect(config.capture).toEqual(DEFAULT_CAPTURE_CONFIG);
  });

  it("should override browsers", () => {
    const config = createTestWorkerConfig({
      browsers: [
        { browserURL: "http://chromium-1:9222" },
        { browserURL: "http://chromium-2:9222" },
      ],
    });

    expect(config.browsers).toEqual([
      { browserURL: "http://chromium-1:9222" },
      { browserURL: "http://chromium-2:9222" },
    ]);
  });

  it("should override nested capture config", () => {
    const config = createTestWorkerConfig({
      capture: { outputDir: "/custom" },
    });

    expect(config.capture.outputDir).toBe("/custom");
  });
});

describe("createTestServerConfig", () => {
  it("should return default config when no overrides", () => {
    const config = createTestServerConfig();
    expect(config.port).toBe(50051);
  });

  it("should override port", () => {
    const config = createTestServerConfig({ port: 8080 });
    expect(config.port).toBe(8080);
  });

  it("should override nested worker config", () => {
    const config = createTestServerConfig({
      worker: { browsers: [{ browserURL: "http://browser:9222" }] },
    });

    expect(config.worker.browsers).toEqual([{ browserURL: "http://browser:9222" }]);
  });
});
