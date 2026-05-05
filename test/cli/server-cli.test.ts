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

  describe("CLI のみ (storage=local)", () => {
    it("--browser-url / --storage=local / --output-dir から config を組み立てる", () => {
      const config = parseCliOptions(
        argv(
          "--browser-url",
          "http://b1:9222",
          "http://b2:9222",
          "--storage",
          "local",
          "--output-dir",
          "/tmp/out",
        ),
      );

      expect(config.coordinator.browserProfiles.map((p) => p.browserURL)).toEqual([
        "http://b1:9222",
        "http://b2:9222",
      ]);
      expect(config.coordinator.storage).toEqual({
        kind: "local",
        outputDir: "/tmp/out",
      });
      expect(config.port).toBe(8080);
    });
  });

  describe("env のみ (storage=local)", () => {
    it("CLI 引数なしでも env から config を組み立てる", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://b1:9222,http://b2:9222");
      vi.stubEnv("BROWSERHIVE_STORAGE", "local");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/env-out");

      const config = parseCliOptions(argv());

      expect(config.coordinator.browserProfiles.map((p) => p.browserURL)).toEqual([
        "http://b1:9222",
        "http://b2:9222",
      ]);
      expect(config.coordinator.storage).toEqual({
        kind: "local",
        outputDir: "/tmp/env-out",
      });
    });

    it("BROWSERHIVE_BROWSER_URLS の前後空白と空要素を除去する", () => {
      vi.stubEnv(
        "BROWSERHIVE_BROWSER_URLS",
        "  http://a:9222 , http://b:9222 ,, ",
      );
      vi.stubEnv("BROWSERHIVE_STORAGE", "local");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");

      const config = parseCliOptions(argv());

      expect(config.coordinator.browserProfiles.map((p) => p.browserURL)).toEqual([
        "http://a:9222",
        "http://b:9222",
      ]);
    });

    it("数値系 env が argParser を経由して反映される", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      vi.stubEnv("BROWSERHIVE_STORAGE", "local");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");
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
      vi.stubEnv("BROWSERHIVE_STORAGE", "local");
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
      vi.stubEnv("BROWSERHIVE_STORAGE", "local");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");
      vi.stubEnv("BROWSERHIVE_PORT", "9090");

      const config = parseCliOptions(argv("--port", "8080"));

      expect(config.port).toBe(8080);
    });
  });

  describe("storage=s3", () => {
    it("CLI で 4 つの必須 --s3-* + --storage=s3 を渡すと S3StorageConfig を組み立てる", () => {
      const config = parseCliOptions(
        argv(
          "--browser-url",
          "http://a:9222",
          "--storage",
          "s3",
          "--s3-endpoint",
          "http://minio:9000",
          "--s3-bucket",
          "browserhive",
          "--s3-access-key-id",
          "AKIATESTACCESSKEYID",
          "--s3-secret-access-key",
          "test-secret-access-key-value",
        ),
      );

      expect(config.coordinator.storage).toMatchObject({
        kind: "s3",
        endpoint: "http://minio:9000",
        region: "us-east-1",
        bucket: "browserhive",
        accessKeyId: "AKIATESTACCESSKEYID",
        secretAccessKey: "test-secret-access-key-value",
        forcePathStyle: true,
      });
    });

    it("env のみで storage=s3 を組み立てる", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      vi.stubEnv("BROWSERHIVE_STORAGE", "s3");
      vi.stubEnv("BROWSERHIVE_S3_ENDPOINT", "http://minio:9000");
      vi.stubEnv("BROWSERHIVE_S3_BUCKET", "browserhive");
      vi.stubEnv("BROWSERHIVE_S3_ACCESS_KEY_ID", "AKIATESTACCESSKEYID");
      vi.stubEnv("BROWSERHIVE_S3_SECRET_ACCESS_KEY", "secret");
      vi.stubEnv("BROWSERHIVE_S3_REGION", "ap-northeast-1");
      vi.stubEnv("BROWSERHIVE_S3_KEY_PREFIX", "captures");

      const config = parseCliOptions(argv());

      expect(config.coordinator.storage).toMatchObject({
        kind: "s3",
        region: "ap-northeast-1",
        keyPrefix: "captures",
      });
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
        vi.stubEnv("BROWSERHIVE_STORAGE", "local");
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
      vi.stubEnv("BROWSERHIVE_STORAGE", "local");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");
      vi.stubEnv("BROWSERHIVE_REJECT_DUPLICATE_URLS", "true");

      const config = parseCliOptions(argv());

      expect(config.coordinator.rejectDuplicateUrls).toBe(true);
    });

    it("CLI フラグ --screenshot-full-page は env=false でも真にする", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      vi.stubEnv("BROWSERHIVE_STORAGE", "local");
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
      vi.stubEnv("BROWSERHIVE_STORAGE", "local");
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
      vi.stubEnv("BROWSERHIVE_STORAGE", "local");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");

      expect(() =>
        parseCliOptions(argv("--tls-cert", "/etc/cert.pem")),
      ).toThrow(ProcessExitError);
    });
  });

  describe("失敗系", () => {
    it("--browser-url が CLI/env のどちらにもなければ exit する", () => {
      vi.stubEnv("BROWSERHIVE_STORAGE", "local");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");

      expect(() => parseCliOptions(argv())).toThrow(ProcessExitError);
    });

    it("--storage が CLI/env のどちらにもなければ exit する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");

      expect(() => parseCliOptions(argv())).toThrow(ProcessExitError);
    });

    it("--storage が不正な値だと exit する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");

      expect(() =>
        parseCliOptions(argv("--storage", "bogus", "--output-dir", "/tmp/out")),
      ).toThrow(ProcessExitError);
    });

    it("--storage=local で --output-dir が無いと exit する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");

      expect(() => parseCliOptions(argv("--storage", "local"))).toThrow(
        ProcessExitError,
      );
    });

    it("--storage=local で --s3-bucket が指定されたら exit する (排他)", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");

      expect(() =>
        parseCliOptions(
          argv(
            "--storage",
            "local",
            "--output-dir",
            "/tmp/out",
            "--s3-bucket",
            "x",
          ),
        ),
      ).toThrow(ProcessExitError);
    });

    it("--storage=s3 で必須 --s3-* が欠けると exit する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");

      expect(() =>
        parseCliOptions(
          argv(
            "--storage",
            "s3",
            "--s3-endpoint",
            "http://minio:9000",
            "--s3-bucket",
            "browserhive",
            // accessKeyId と secretAccessKey を意図的に欠落
          ),
        ),
      ).toThrow(ProcessExitError);
    });

    it("--storage=s3 で --output-dir が指定されたら exit する (排他)", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");

      expect(() =>
        parseCliOptions(
          argv(
            "--storage",
            "s3",
            "--output-dir",
            "/tmp/out",
            "--s3-endpoint",
            "http://minio:9000",
            "--s3-bucket",
            "x",
            "--s3-access-key-id",
            "A",
            "--s3-secret-access-key",
            "S",
          ),
        ),
      ).toThrow(ProcessExitError);
    });

    it("BROWSERHIVE_BROWSER_URLS が空白だけの場合は missing 扱いで exit する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "  ,  ,");
      vi.stubEnv("BROWSERHIVE_STORAGE", "local");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");

      expect(() => parseCliOptions(argv())).toThrow(ProcessExitError);
    });

    it("不正な BROWSERHIVE_PORT で exit する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      vi.stubEnv("BROWSERHIVE_STORAGE", "local");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");
      vi.stubEnv("BROWSERHIVE_PORT", "abc");

      expect(() => parseCliOptions(argv())).toThrow(ProcessExitError);
    });

    it("不正な BROWSERHIVE_SCREENSHOT_FULL_PAGE で exit する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      vi.stubEnv("BROWSERHIVE_STORAGE", "local");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");
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
          "--storage",
          "local",
          "--output-dir",
          "/tmp/out",
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
      vi.stubEnv("BROWSERHIVE_STORAGE", "local");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");
      vi.stubEnv("BROWSERHIVE_TASK_TIMEOUT_MS", "45000");

      const config = parseCliOptions(argv());

      expect(
        config.coordinator.browserProfiles[0]?.capture.timeouts.taskTotal,
      ).toBe(45000);
    });

    it("未指定時はデフォルト 100s が入る", () => {
      const config = parseCliOptions(
        argv(
          "--browser-url",
          "http://a:9222",
          "--storage",
          "local",
          "--output-dir",
          "/tmp/out",
        ),
      );

      expect(
        config.coordinator.browserProfiles[0]?.capture.timeouts.taskTotal,
      ).toBe(100000);
    });

    it("不正な BROWSERHIVE_TASK_TIMEOUT_MS で exit する", () => {
      vi.stubEnv("BROWSERHIVE_BROWSER_URLS", "http://a:9222");
      vi.stubEnv("BROWSERHIVE_STORAGE", "local");
      vi.stubEnv("BROWSERHIVE_OUTPUT_DIR", "/tmp/out");
      vi.stubEnv("BROWSERHIVE_TASK_TIMEOUT_MS", "0");

      expect(() => parseCliOptions(argv())).toThrow(ProcessExitError);
    });
  });
});
