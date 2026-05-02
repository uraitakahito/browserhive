import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseCliOptions } from "../../src/cli/server-cli.js";
import {
  SERVER_ENV_VARS,
  setupCliTestEnv,
  teardownCliTestEnv,
  argv,
  ProcessExitError,
} from "../helpers/cli-env.js";
import { vi } from "vitest";

describe("server-cli parseCliOptions", () => {
  beforeEach(() => {
    setupCliTestEnv(SERVER_ENV_VARS);
  });
  afterEach(() => {
    teardownCliTestEnv();
  });

  describe("CLI のみ", () => {
    it("--browser-url と --output から config を組み立てる", () => {
      const config = parseCliOptions(
        argv(
          "--browser-url",
          "http://b1:9222",
          "http://b2:9222",
          "--output",
          "/tmp/out",
        ),
      );

      expect(config.coordinator.browserProfiles.map((p) => p.browserURL)).toEqual([
        "http://b1:9222",
        "http://b2:9222",
      ]);
      expect(config.coordinator.browserProfiles[0]?.capture.outputDir).toBe(
        "/tmp/out",
      );
      expect(config.port).toBe(50051);
    });
  });

  describe("env のみ", () => {
    it("CLI 引数なしでも env から config を組み立てる", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://b1:9222,http://b2:9222");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/env-out");

      const config = parseCliOptions(argv());

      expect(config.coordinator.browserProfiles.map((p) => p.browserURL)).toEqual([
        "http://b1:9222",
        "http://b2:9222",
      ]);
      expect(config.coordinator.browserProfiles[0]?.capture.outputDir).toBe(
        "/tmp/env-out",
      );
    });

    it("BROWSERHIVE_BROWSER_URLS の前後空白と空要素を除去する", () => {
      vi.stubEnv(
        "BROWSERHIVE_BROWSER_URLS",
        "  http://a:9222 , http://b:9222 ,, ",
      );
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");

      const config = parseCliOptions(argv());

      expect(config.coordinator.browserProfiles.map((p) => p.browserURL)).toEqual([
        "http://a:9222",
        "http://b:9222",
      ]);
    });

    it("数値系 env が argParser を経由して反映される", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");
      vi.stubEnv("BROWSERHIVE_PORT", "9090");
      vi.stubEnv("BROWSERHIVE_MAX_RETRY_COUNT", "5");
      vi.stubEnv("BROWSERHIVE_QUEUE_POLL_INTERVAL_MS", "200");
      vi.stubEnv("BROWSERHIVE_VIEWPORT_WIDTH", "1920");
      vi.stubEnv("BROWSERHIVE_VIEWPORT_HEIGHT", "1080");
      vi.stubEnv("BROWSERHIVE_SCREENSHOT_QUALITY", "85");
      vi.stubEnv("BROWSERHIVE_USER_AGENT", "TestBot/1.0");
      vi.stubEnv("BROWSERHIVE_ACCEPT_LANGUAGE", "ja-JP");

      const config = parseCliOptions(argv());

      expect(config.port).toBe(9090);
      expect(config.coordinator.maxRetryCount).toBe(5);
      expect(config.coordinator.queuePollIntervalMs).toBe(200);
      const capture = config.coordinator.browserProfiles[0]?.capture;
      expect(capture?.viewport).toEqual({ width: 1920, height: 1080 });
      expect(capture?.screenshot.quality).toBe(85);
      expect(capture?.userAgent).toBe("TestBot/1.0");
      expect(capture?.acceptLanguage).toBe("ja-JP");
    });
  });

  describe("CLI > env の優先順位", () => {
    it("--browser-url が env を上書きする", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://from-env:9222");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");

      const config = parseCliOptions(
        argv("--browser-url", "http://from-cli:9222"),
      );

      expect(config.coordinator.browserProfiles.map((p) => p.browserURL)).toEqual([
        "http://from-cli:9222",
      ]);
    });

    it("--port が env を上書きする", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");
      vi.stubEnv("BROWSERHIVE_PORT", "9090");

      const config = parseCliOptions(argv("--port", "8080"));

      expect(config.port).toBe(8080);
    });
  });

  describe("ブール値 env", () => {
    it.each([
      ["true", true],
      ["1", true],
      ["TRUE", true],
      ["false", false],
      ["0", false],
      ["", false],
    ] as const)(
      "BROWSERHIVE_SCREENSHOT_FULL_PAGE='%s' → %s",
      (raw, expected) => {
        vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
        vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");
        vi.stubEnv("BROWSERHIVE_SCREENSHOT_FULL_PAGE", raw);

        const config = parseCliOptions(argv());

        expect(
          config.coordinator.browserProfiles[0]?.capture.screenshot.fullPage,
        ).toBe(expected);
      },
    );

    it("BROWSERHIVE_REJECT_DUPLICATE_URLS='true' で真になる", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");
      vi.stubEnv("BROWSERHIVE_REJECT_DUPLICATE_URLS", "true");

      const config = parseCliOptions(argv());

      expect(config.coordinator.rejectDuplicateUrls).toBe(true);
    });

    it("CLI フラグ --screenshot-full-page は env=false でも真にする", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");
      vi.stubEnv("BROWSERHIVE_SCREENSHOT_FULL_PAGE", "false");

      const config = parseCliOptions(argv("--screenshot-full-page"));

      expect(
        config.coordinator.browserProfiles[0]?.capture.screenshot.fullPage,
      ).toBe(true);
    });
  });

  describe("TLS", () => {
    it("CLI の --tls-cert と env の BROWSERHIVE_TLS_KEY を合成できる", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");
      vi.stubEnv("BROWSERHIVE_TLS_KEY", "/etc/key.pem");

      const config = parseCliOptions(argv("--tls-cert", "/etc/cert.pem"));

      expect(config.tls).toEqual({
        enabled: true,
        certPath: "/etc/cert.pem",
        keyPath: "/etc/key.pem",
      });
    });

    it("--tls-cert のみ（key が CLI/env いずれも未指定）で exit する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");

      expect(() =>
        parseCliOptions(argv("--tls-cert", "/etc/cert.pem")),
      ).toThrow(ProcessExitError);
    });
  });

  describe("失敗系", () => {
    it("--browser-url が CLI/env のどちらにもなければ exit する", () => {
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");

      expect(() => parseCliOptions(argv())).toThrow(ProcessExitError);
    });

    it("--output が CLI/env のどちらにもなければ exit する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");

      expect(() => parseCliOptions(argv())).toThrow(ProcessExitError);
    });

    it("BROWSERHIVE_BROWSER_URLS が空白だけの場合は missing 扱いで exit する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "  ,  ,");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");

      expect(() => parseCliOptions(argv())).toThrow(ProcessExitError);
    });

    it("不正な BROWSERHIVE_PORT で exit する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");
      vi.stubEnv("BROWSERHIVE_PORT", "abc");

      expect(() => parseCliOptions(argv())).toThrow(ProcessExitError);
    });

    it("不正な BROWSERHIVE_SCREENSHOT_FULL_PAGE で exit する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");
      vi.stubEnv("BROWSERHIVE_SCREENSHOT_FULL_PAGE", "yes");

      expect(() => parseCliOptions(argv())).toThrow(ProcessExitError);
    });
  });
});
