import { describe, it, expect } from "vitest";
import {
  DEFAULT_CAPTURE_CONFIG,
  DEFAULT_COORDINATOR_CONFIG,
  DEFAULT_BROWSERHIVE_CONFIG,
} from "../../src/config/index.js";
import {
  createTestCaptureConfig,
  createTestCoordinatorConfig,
  createTestBrowserHiveConfig,
} from "../helpers/config.js";

describe("DEFAULT_CAPTURE_CONFIG", () => {
  it("should have correct default values", () => {
    expect(DEFAULT_CAPTURE_CONFIG.timeouts.pageLoad).toBe(30000);
    expect(DEFAULT_CAPTURE_CONFIG.timeouts.capture).toBe(10000);
    expect(DEFAULT_CAPTURE_CONFIG.viewport.width).toBe(1280);
    expect(DEFAULT_CAPTURE_CONFIG.viewport.height).toBe(800);
    expect(DEFAULT_CAPTURE_CONFIG.screenshot.fullPage).toBe(false);
    expect(DEFAULT_CAPTURE_CONFIG.userAgent).toBeUndefined();
  });
});

describe("DEFAULT_COORDINATOR_CONFIG", () => {
  it("should have empty browserProfiles by default", () => {
    expect(DEFAULT_COORDINATOR_CONFIG.browserProfiles).toEqual([]);
  });

  it("does not include a default storage entry (CLI / env supply it)", () => {
    expect(DEFAULT_COORDINATOR_CONFIG).not.toHaveProperty("storage");
  });

  it("should have correct default values for pool settings", () => {
    expect(DEFAULT_COORDINATOR_CONFIG.maxRetryCount).toBe(2);
    expect(DEFAULT_COORDINATOR_CONFIG.queuePollIntervalMs).toBe(50);
    expect(DEFAULT_COORDINATOR_CONFIG.rejectDuplicateUrls).toBe(false);
  });
});

describe("DEFAULT_BROWSERHIVE_CONFIG", () => {
  it("should have correct default port", () => {
    expect(DEFAULT_BROWSERHIVE_CONFIG.port).toBe(8080);
  });

  it("should contain DEFAULT_COORDINATOR_CONFIG", () => {
    expect(DEFAULT_BROWSERHIVE_CONFIG.coordinator).toEqual(DEFAULT_COORDINATOR_CONFIG);
  });
});

describe("createTestCaptureConfig", () => {
  it("should return default config when no overrides", () => {
    const config = createTestCaptureConfig();
    expect(config).toEqual(DEFAULT_CAPTURE_CONFIG);
  });

  it("should override userAgent", () => {
    const config = createTestCaptureConfig({
      userAgent: "X",
    });

    expect(config.userAgent).toBe("X");
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

describe("createTestCoordinatorConfig", () => {
  it("should return default config when no overrides", () => {
    const config = createTestCoordinatorConfig();
    expect(config.browserProfiles).toEqual([]);
  });

  it("should override browserProfiles", () => {
    const config = createTestCoordinatorConfig({
      browserProfiles: [
        { browserURL: "http://chromium-1:9222", capture: DEFAULT_CAPTURE_CONFIG },
        { browserURL: "http://chromium-2:9222", capture: DEFAULT_CAPTURE_CONFIG },
      ],
    });

    expect(config.browserProfiles).toHaveLength(2);
    expect(config.browserProfiles[0]!.browserURL).toBe("http://chromium-1:9222");
    expect(config.browserProfiles[1]!.browserURL).toBe("http://chromium-2:9222");
  });

  it("should override pool settings", () => {
    const config = createTestCoordinatorConfig({
      maxRetryCount: 5,
      queuePollIntervalMs: 100,
      rejectDuplicateUrls: true,
    });

    expect(config.maxRetryCount).toBe(5);
    expect(config.queuePollIntervalMs).toBe(100);
    expect(config.rejectDuplicateUrls).toBe(true);
  });
});

describe("createTestBrowserHiveConfig", () => {
  it("should return default config when no overrides", () => {
    const config = createTestBrowserHiveConfig();
    expect(config.port).toBe(8080);
  });

  it("should override port", () => {
    const config = createTestBrowserHiveConfig({ port: 8080 });
    expect(config.port).toBe(8080);
  });

  it("should override nested coordinator config", () => {
    const config = createTestBrowserHiveConfig({
      coordinator: { browserProfiles: [{ browserURL: "http://browser:9222", capture: DEFAULT_CAPTURE_CONFIG }] },
    });

    expect(config.coordinator.browserProfiles).toHaveLength(1);
    expect(config.coordinator.browserProfiles[0]!.browserURL).toBe("http://browser:9222");
  });
});
