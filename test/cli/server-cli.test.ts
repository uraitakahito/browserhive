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

/**
 * Common minimum CLI args that satisfy the four required `--s3-*` fields.
 * Tests that exercise other flags reuse this prefix to keep their
 * argv lists focused on the field under test.
 */
const s3Args = [
  "--s3-endpoint",
  "http://seaweedfs:8333",
  "--s3-bucket",
  "browserhive",
  "--s3-access-key-id",
  "AKIATESTACCESSKEYID",
  "--s3-secret-access-key",
  "test-secret-access-key-value",
];

const stubS3Env = (): void => {
  vi.stubEnv("BROWSERHIVE_S3_ENDPOINT", "http://seaweedfs:8333");
  vi.stubEnv("BROWSERHIVE_S3_BUCKET", "browserhive");
  vi.stubEnv("BROWSERHIVE_S3_ACCESS_KEY_ID", "AKIATESTACCESSKEYID");
  vi.stubEnv("BROWSERHIVE_S3_SECRET_ACCESS_KEY", "test-secret-access-key-value");
};

describe("server-cli parseCliOptions", () => {
  beforeEach(() => {
    setupCliTestEnv(SERVER_ENV_VARS);
  });
  afterEach(() => {
    teardownCliTestEnv();
  });

  describe("CLI のみ", () => {
    it("--browser-url と必須 --s3-* から StorageConfig を組み立てる", () => {
      const config = parseCliOptions(
        argv("--browser-url", "http://b1:9222", "http://b2:9222", ...s3Args),
      );

      expect(config.coordinator.browserProfiles.map((p) => p.browserURL)).toEqual([
        "http://b1:9222",
        "http://b2:9222",
      ]);
      expect(config.coordinator.storage).toEqual({
        endpoint: "http://seaweedfs:8333",
        region: "us-east-1",
        bucket: "browserhive",
        accessKeyId: "AKIATESTACCESSKEYID",
        secretAccessKey: "test-secret-access-key-value",
        forcePathStyle: true,
      });
      expect(config.port).toBe(8080);
    });

    it("--s3-region と --s3-key-prefix の上書きが反映される", () => {
      const config = parseCliOptions(
        argv(
          "--browser-url",
          "http://b1:9222",
          ...s3Args,
          "--s3-region",
          "ap-northeast-1",
          "--s3-key-prefix",
          "captures/2026",
        ),
      );

      expect(config.coordinator.storage).toMatchObject({
        region: "ap-northeast-1",
        keyPrefix: "captures/2026",
      });
    });
  });

  describe("env のみ", () => {
    it("CLI 引数なしでも env から config を組み立てる", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://b1:9222,http://b2:9222");
      stubS3Env();
      vi.stubEnv("BROWSERHIVE_S3_REGION", "ap-northeast-1");
      vi.stubEnv("BROWSERHIVE_S3_KEY_PREFIX", "captures");

      const config = parseCliOptions(argv());

      expect(config.coordinator.browserProfiles.map((p) => p.browserURL)).toEqual([
        "http://b1:9222",
        "http://b2:9222",
      ]);
      expect(config.coordinator.storage).toMatchObject({
        endpoint: "http://seaweedfs:8333",
        bucket: "browserhive",
        region: "ap-northeast-1",
        keyPrefix: "captures",
      });
    });

    it("BROWSERHIVE_BROWSER_URLS の前後空白と空要素を除去する", () => {
      vi.stubEnv(
        "BROWSERHIVE_BROWSER_URLS",
        "  http://a:9222 , http://b:9222 ,, ",
      );
      stubS3Env();

      const config = parseCliOptions(argv());

      expect(config.coordinator.browserProfiles.map((p) => p.browserURL)).toEqual([
        "http://a:9222",
        "http://b:9222",
      ]);
    });

    it("数値系 env が argParser を経由して反映される", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      stubS3Env();
      vi.stubEnv("BROWSERHIVE_PORT", "9090");
      vi.stubEnv("BROWSERHIVE_MAX_RETRY_COUNT", "5");
      vi.stubEnv("BROWSERHIVE_QUEUE_POLL_INTERVAL_MS", "200");
      vi.stubEnv("BROWSERHIVE_VIEWPORT_WIDTH", "1920");
      vi.stubEnv("BROWSERHIVE_VIEWPORT_HEIGHT", "1080");
      vi.stubEnv("BROWSERHIVE_SCREENSHOT_QUALITY", "85");
      vi.stubEnv("BROWSERHIVE_USER_AGENT", "TestBot/1.0");

      const config = parseCliOptions(argv());

      expect(config.port).toBe(9090);
      expect(config.coordinator.maxRetryCount).toBe(5);
      expect(config.coordinator.queuePollIntervalMs).toBe(200);
      const capture = config.coordinator.browserProfiles[0]?.capture;
      expect(capture?.viewport).toEqual({ width: 1920, height: 1080 });
      expect(capture?.screenshot.quality).toBe(85);
      expect(capture?.userAgent).toBe("TestBot/1.0");
    });
  });

  describe("CLI > env の優先順位", () => {
    it("--browser-url が env を上書きする", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://from-env:9222");
      stubS3Env();

      const config = parseCliOptions(
        argv("--browser-url", "http://from-cli:9222"),
      );

      expect(config.coordinator.browserProfiles.map((p) => p.browserURL)).toEqual([
        "http://from-cli:9222",
      ]);
    });

    it("--port が env を上書きする", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      stubS3Env();
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
        stubS3Env();
        vi.stubEnv("BROWSERHIVE_SCREENSHOT_FULL_PAGE", raw);

        const config = parseCliOptions(argv());

        expect(
          config.coordinator.browserProfiles[0]?.capture.screenshot.fullPage,
        ).toBe(expected);
      },
    );

    it("BROWSERHIVE_REJECT_DUPLICATE_URLS='true' で真になる", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      stubS3Env();
      vi.stubEnv("BROWSERHIVE_REJECT_DUPLICATE_URLS", "true");

      const config = parseCliOptions(argv());

      expect(config.coordinator.rejectDuplicateUrls).toBe(true);
    });

    it("CLI フラグ --screenshot-full-page は env=false でも真にする", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      stubS3Env();
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
      stubS3Env();
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
      stubS3Env();

      expect(() =>
        parseCliOptions(argv("--tls-cert", "/etc/cert.pem")),
      ).toThrow(ProcessExitError);
    });
  });

  describe("失敗系", () => {
    it("--browser-url が CLI/env のどちらにもなければ exit する", () => {
      stubS3Env();

      expect(() => parseCliOptions(argv())).toThrow(ProcessExitError);
    });

    it("--s3-endpoint が CLI/env のどちらにもなければ exit する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      vi.stubEnv("BROWSERHIVE_S3_BUCKET", "browserhive");
      vi.stubEnv("BROWSERHIVE_S3_ACCESS_KEY_ID", "AKIATESTACCESSKEYID");
      vi.stubEnv("BROWSERHIVE_S3_SECRET_ACCESS_KEY", "secret");

      expect(() => parseCliOptions(argv())).toThrow(ProcessExitError);
    });

    it("--s3-bucket が CLI/env のどちらにもなければ exit する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      vi.stubEnv("BROWSERHIVE_S3_ENDPOINT", "http://seaweedfs:8333");
      vi.stubEnv("BROWSERHIVE_S3_ACCESS_KEY_ID", "AKIATESTACCESSKEYID");
      vi.stubEnv("BROWSERHIVE_S3_SECRET_ACCESS_KEY", "secret");

      expect(() => parseCliOptions(argv())).toThrow(ProcessExitError);
    });

    it("--s3-access-key-id が CLI/env のどちらにもなければ exit する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      vi.stubEnv("BROWSERHIVE_S3_ENDPOINT", "http://seaweedfs:8333");
      vi.stubEnv("BROWSERHIVE_S3_BUCKET", "browserhive");
      vi.stubEnv("BROWSERHIVE_S3_SECRET_ACCESS_KEY", "secret");

      expect(() => parseCliOptions(argv())).toThrow(ProcessExitError);
    });

    it("--s3-secret-access-key が CLI/env のどちらにもなければ exit する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      vi.stubEnv("BROWSERHIVE_S3_ENDPOINT", "http://seaweedfs:8333");
      vi.stubEnv("BROWSERHIVE_S3_BUCKET", "browserhive");
      vi.stubEnv("BROWSERHIVE_S3_ACCESS_KEY_ID", "AKIATESTACCESSKEYID");

      expect(() => parseCliOptions(argv())).toThrow(ProcessExitError);
    });

    it("BROWSERHIVE_BROWSER_URLS が空白だけの場合は missing 扱いで exit する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "  ,  ,");
      stubS3Env();

      expect(() => parseCliOptions(argv())).toThrow(ProcessExitError);
    });

    it("不正な BROWSERHIVE_PORT で exit する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      stubS3Env();
      vi.stubEnv("BROWSERHIVE_PORT", "abc");

      expect(() => parseCliOptions(argv())).toThrow(ProcessExitError);
    });

    it("不正な BROWSERHIVE_SCREENSHOT_FULL_PAGE で exit する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      stubS3Env();
      vi.stubEnv("BROWSERHIVE_SCREENSHOT_FULL_PAGE", "yes");

      expect(() => parseCliOptions(argv())).toThrow(ProcessExitError);
    });
  });

  describe("taskTotal (Layer B safety net)", () => {
    it("--task-timeout が capture.timeouts.taskTotal に反映される", () => {
      const config = parseCliOptions(
        argv(
          "--browser-url",
          "http://a:9222",
          ...s3Args,
          "--task-timeout",
          "60000",
        ),
      );

      expect(
        config.coordinator.browserProfiles[0]?.capture.timeouts.taskTotal,
      ).toBe(60000);
    });

    it("BROWSERHIVE_TASK_TIMEOUT_MS が capture.timeouts.taskTotal に反映される", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      stubS3Env();
      vi.stubEnv("BROWSERHIVE_TASK_TIMEOUT_MS", "45000");

      const config = parseCliOptions(argv());

      expect(
        config.coordinator.browserProfiles[0]?.capture.timeouts.taskTotal,
      ).toBe(45000);
    });

    it("未指定時はデフォルト 100s が入る", () => {
      const config = parseCliOptions(
        argv("--browser-url", "http://a:9222", ...s3Args),
      );

      expect(
        config.coordinator.browserProfiles[0]?.capture.timeouts.taskTotal,
      ).toBe(100000);
    });

    it("不正な BROWSERHIVE_TASK_TIMEOUT_MS で exit する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      stubS3Env();
      vi.stubEnv("BROWSERHIVE_TASK_TIMEOUT_MS", "0");

      expect(() => parseCliOptions(argv())).toThrow(ProcessExitError);
    });
  });

  describe("resetPageState (CLI/env)", () => {
    it("既定で両 axis が true（後方互換: 既存の wipe 挙動）", () => {
      const config = parseCliOptions(
        argv("--browser-url", "http://a:9222", ...s3Args),
      );

      expect(
        config.coordinator.browserProfiles[0]?.capture.resetPageState,
      ).toEqual({ cookies: true, pageContext: true });
    });

    it("--no-reset-cookies で cookies のみ false にする", () => {
      const config = parseCliOptions(
        argv("--browser-url", "http://a:9222", ...s3Args, "--no-reset-cookies"),
      );

      expect(
        config.coordinator.browserProfiles[0]?.capture.resetPageState,
      ).toEqual({ cookies: false, pageContext: true });
    });

    it("--no-reset-page-context で pageContext のみ false にする", () => {
      const config = parseCliOptions(
        argv(
          "--browser-url",
          "http://a:9222",
          ...s3Args,
          "--no-reset-page-context",
        ),
      );

      expect(
        config.coordinator.browserProfiles[0]?.capture.resetPageState,
      ).toEqual({ cookies: true, pageContext: false });
    });

    it("両 CLI フラグで両 axis を false にする", () => {
      const config = parseCliOptions(
        argv(
          "--browser-url",
          "http://a:9222",
          ...s3Args,
          "--no-reset-cookies",
          "--no-reset-page-context",
        ),
      );

      expect(
        config.coordinator.browserProfiles[0]?.capture.resetPageState,
      ).toEqual({ cookies: false, pageContext: false });
    });

    it("BROWSERHIVE_RESET_COOKIES=false が cookies axis を反転する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      stubS3Env();
      vi.stubEnv("BROWSERHIVE_RESET_COOKIES", "false");

      const config = parseCliOptions(argv());

      expect(
        config.coordinator.browserProfiles[0]?.capture.resetPageState,
      ).toEqual({ cookies: false, pageContext: true });
    });

    it("BROWSERHIVE_RESET_PAGE_CONTEXT='0' が pageContext axis を反転する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      stubS3Env();
      vi.stubEnv("BROWSERHIVE_RESET_PAGE_CONTEXT", "0");

      const config = parseCliOptions(argv());

      expect(
        config.coordinator.browserProfiles[0]?.capture.resetPageState,
      ).toEqual({ cookies: true, pageContext: false });
    });

    it("CLI 否定 > env: --no-reset-cookies は env=true を上書きしない（CLI が勝つ）", () => {
      // CLI で false を選ぶ → env=true は読まれず CLI が勝つ。
      vi.stubEnv("BROWSERHIVE_RESET_COOKIES", "true");
      const config = parseCliOptions(
        argv("--browser-url", "http://a:9222", ...s3Args, "--no-reset-cookies"),
      );

      expect(
        config.coordinator.browserProfiles[0]?.capture.resetPageState.cookies,
      ).toBe(false);
    });

    it("不正な BROWSERHIVE_RESET_COOKIES で exit する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      stubS3Env();
      vi.stubEnv("BROWSERHIVE_RESET_COOKIES", "maybe");

      expect(() => parseCliOptions(argv())).toThrow(ProcessExitError);
    });
  });

  describe("WACZ (CLI/env)", () => {
    it("WACZ デフォルト値が CaptureConfig.wacz に反映される", () => {
      const config = parseCliOptions(
        argv("--browser-url", "http://a:9222", ...s3Args),
      );

      const wacz = config.coordinator.browserProfiles[0]?.capture.wacz;
      expect(wacz).toBeDefined();
      expect(wacz?.maxResponseBytes).toBe(20 * 1024 * 1024);
      expect(wacz?.maxTaskBytes).toBe(200 * 1024 * 1024);
      expect(wacz?.maxPendingRequests).toBe(5000);
      // Default block-list should include the bundled analytics patterns.
      expect(wacz?.blockUrlPatterns.some((p) => p.includes("google-analytics"))).toBe(true);
      // No skip-content-types by default.
      expect(wacz?.skipContentTypes).toEqual([]);
      // Software identifier reads from package.json — version is non-empty.
      expect(wacz?.software).toMatch(/^browserhive\/[^/]+$/);
    });

    it("--wacz-max-response-bytes / --wacz-max-task-bytes / --wacz-max-pending-requests を上書きできる", () => {
      const config = parseCliOptions(
        argv(
          "--browser-url",
          "http://a:9222",
          ...s3Args,
          "--wacz-max-response-bytes",
          "1048576",
          "--wacz-max-task-bytes",
          "10485760",
          "--wacz-max-pending-requests",
          "100",
        ),
      );

      const wacz = config.coordinator.browserProfiles[0]?.capture.wacz;
      expect(wacz?.maxResponseBytes).toBe(1048576);
      expect(wacz?.maxTaskBytes).toBe(10485760);
      expect(wacz?.maxPendingRequests).toBe(100);
    });

    it("--wacz-block-pattern (variadic) で CLI 値が defaults を完全に置き換える", () => {
      const config = parseCliOptions(
        argv(
          "--browser-url",
          "http://a:9222",
          ...s3Args,
          "--wacz-block-pattern",
          "*://only.example.com/*",
          "*://other.example.com/*",
        ),
      );

      expect(
        config.coordinator.browserProfiles[0]?.capture.wacz?.blockUrlPatterns,
      ).toEqual([
        "*://only.example.com/*",
        "*://other.example.com/*",
      ]);
    });

    it("BROWSERHIVE_WACZ_BLOCK_PATTERNS をカンマ区切りで解釈する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      stubS3Env();
      vi.stubEnv(
        "BROWSERHIVE_WACZ_BLOCK_PATTERNS",
        "*://x.example.com/*, *://y.example.com/*",
      );

      const config = parseCliOptions(argv());

      expect(
        config.coordinator.browserProfiles[0]?.capture.wacz?.blockUrlPatterns,
      ).toEqual([
        "*://x.example.com/*",
        "*://y.example.com/*",
      ]);
    });

    it("CLI が env より優先される (block-pattern)", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      stubS3Env();
      vi.stubEnv("BROWSERHIVE_WACZ_BLOCK_PATTERNS", "*://env.example.com/*");

      const config = parseCliOptions(
        argv("--wacz-block-pattern", "*://cli.example.com/*"),
      );

      expect(
        config.coordinator.browserProfiles[0]?.capture.wacz?.blockUrlPatterns,
      ).toEqual(["*://cli.example.com/*"]);
    });

    it("--wacz-skip-content-types で MIME プレフィックスを設定できる", () => {
      const config = parseCliOptions(
        argv(
          "--browser-url",
          "http://a:9222",
          ...s3Args,
          "--wacz-skip-content-types",
          "video/",
          "audio/",
        ),
      );

      expect(
        config.coordinator.browserProfiles[0]?.capture.wacz?.skipContentTypes,
      ).toEqual(["video/", "audio/"]);
    });

    it("不正な --wacz-max-response-bytes (0) で exit する", () => {
      expect(() =>
        parseCliOptions(
          argv(
            "--browser-url",
            "http://a:9222",
            ...s3Args,
            "--wacz-max-response-bytes",
            "0",
          ),
        ),
      ).toThrow();
    });
  });
});
