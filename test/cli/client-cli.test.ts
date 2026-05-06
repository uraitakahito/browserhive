import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { vi } from "vitest";
import { getCaptureFormats, parseClientOptions } from "../../src/cli/client-cli.js";
import {
  CLIENT_ENV_VARS,
  setupCliTestEnv,
  teardownCliTestEnv,
  ProcessExitError,
} from "../helpers/cli-env.js";

const argv = (...rest: string[]): string[] => ["node", "data-client", ...rest];

describe("client-cli parseClientOptions", () => {
  beforeEach(() => {
    setupCliTestEnv(CLIENT_ENV_VARS);
  });
  afterEach(() => {
    teardownCliTestEnv();
  });

  it("CLI 引数の --data だけで既定値が組み立つ", () => {
    // --server は commander 既定値を持たない(SDK の baked-in baseUrl にフォールバックさせる)。
    // 本テストでは未指定で undefined となることだけ確認する。
    const opts = parseClientOptions(argv("--data", "data/smoke-test.yaml"));
    expect(opts.server).toBeUndefined();
    expect(opts.data).toBe("data/smoke-test.yaml");
    expect(opts.tlsCaCert).toBeUndefined();
  });

  it("BROWSERHIVE_SERVER で --server を上書きできる", () => {
    vi.stubEnv("BROWSERHIVE_SERVER", "https://browserhive.internal:9443");
    const opts = parseClientOptions(argv("--data", "data/smoke-test.yaml"));
    expect(opts.server).toBe("https://browserhive.internal:9443");
  });

  it("CLI の --server が env を上書きする", () => {
    vi.stubEnv("BROWSERHIVE_SERVER", "https://browserhive.internal:9443");
    const opts = parseClientOptions(
      argv("--data", "data/smoke-test.yaml", "--server", "http://127.0.0.1:9000"),
    );
    expect(opts.server).toBe("http://127.0.0.1:9000");
  });

  it("BROWSERHIVE_TLS_CA_CERT が tlsCaCert に反映される", () => {
    vi.stubEnv("BROWSERHIVE_TLS_CA_CERT", "/etc/ca.pem");
    const opts = parseClientOptions(argv("--data", "data/smoke-test.yaml"));
    expect(opts.tlsCaCert).toBe("/etc/ca.pem");
  });

  it("--data が CLI 必須なので未指定だと exit する", () => {
    expect(() => parseClientOptions(argv())).toThrow(ProcessExitError);
  });

  it("--accept-language を渡すと acceptLanguage に反映される", () => {
    const opts = parseClientOptions(
      argv("--data", "data/smoke-test.yaml", "--accept-language", "ja-JP,ja;q=0.9,en;q=0.8"),
    );
    expect(opts.acceptLanguage).toBe("ja-JP,ja;q=0.9,en;q=0.8");
  });

  it("--accept-language の前後空白は trim される", () => {
    const opts = parseClientOptions(
      argv("--data", "data/smoke-test.yaml", "--accept-language", "  ja-JP  "),
    );
    expect(opts.acceptLanguage).toBe("ja-JP");
  });

  it("--accept-language に空文字 / 空白のみを渡すと exit する", () => {
    expect(() =>
      parseClientOptions(argv("--data", "data/smoke-test.yaml", "--accept-language", "")),
    ).toThrow(ProcessExitError);
    expect(() =>
      parseClientOptions(argv("--data", "data/smoke-test.yaml", "--accept-language", "   ")),
    ).toThrow(ProcessExitError);
  });

  it("--accept-language 未指定なら ClientOptions にキー自体が乗らない", () => {
    const opts = parseClientOptions(argv("--data", "data/smoke-test.yaml"));
    // exactOptionalPropertyTypes 下では「キーが無い」と「undefined」を区別する。
    expect("acceptLanguage" in opts).toBe(false);
  });

  it("--pdf を渡すと captureFormats.pdf が true になる", () => {
    const opts = parseClientOptions(argv("--data", "data/smoke-test.yaml", "--pdf"));
    expect(opts.pdf).toBe(true);
    expect(getCaptureFormats(opts)).toEqual({
      png: false,
      jpeg: false,
      html: false,
      links: false,
      pdf: true,
      mhtml: false,
    });
  });

  it("--pdf 未指定なら getCaptureFormats が pdf:false を返す", () => {
    const opts = parseClientOptions(argv("--data", "data/smoke-test.yaml", "--png"));
    expect(opts.pdf).toBeUndefined();
    expect(getCaptureFormats(opts).pdf).toBe(false);
  });

  it("--mhtml を渡すと captureFormats.mhtml が true になる", () => {
    const opts = parseClientOptions(argv("--data", "data/smoke-test.yaml", "--mhtml"));
    expect(opts.mhtml).toBe(true);
    expect(getCaptureFormats(opts)).toEqual({
      png: false,
      jpeg: false,
      html: false,
      links: false,
      pdf: false,
      mhtml: true,
    });
  });

  it("--mhtml 未指定なら getCaptureFormats が mhtml:false を返す", () => {
    const opts = parseClientOptions(argv("--data", "data/smoke-test.yaml", "--png"));
    expect(opts.mhtml).toBeUndefined();
    expect(getCaptureFormats(opts).mhtml).toBe(false);
  });

  it("--viewport-width / --viewport-height をペアで渡すと両方反映される", () => {
    const opts = parseClientOptions(
      argv(
        "--data",
        "data/smoke-test.yaml",
        "--viewport-width",
        "1920",
        "--viewport-height",
        "1080",
      ),
    );
    expect(opts.viewportWidth).toBe(1920);
    expect(opts.viewportHeight).toBe(1080);
  });

  it("--viewport-width だけだと exit する(ペア必須)", () => {
    expect(() =>
      parseClientOptions(
        argv("--data", "data/smoke-test.yaml", "--viewport-width", "1920"),
      ),
    ).toThrow(ProcessExitError);
  });

  it("--viewport-height だけだと exit する(ペア必須)", () => {
    expect(() =>
      parseClientOptions(
        argv("--data", "data/smoke-test.yaml", "--viewport-height", "1080"),
      ),
    ).toThrow(ProcessExitError);
  });

  it("--viewport-* 未指定なら ClientOptions にキー自体が乗らない", () => {
    const opts = parseClientOptions(argv("--data", "data/smoke-test.yaml"));
    expect("viewportWidth" in opts).toBe(false);
    expect("viewportHeight" in opts).toBe(false);
  });

  it("--full-page を渡すと fullPage が true になる", () => {
    const opts = parseClientOptions(
      argv("--data", "data/smoke-test.yaml", "--full-page"),
    );
    expect(opts.fullPage).toBe(true);
  });

  it("--full-page 未指定なら ClientOptions にキー自体が乗らない", () => {
    const opts = parseClientOptions(argv("--data", "data/smoke-test.yaml"));
    expect("fullPage" in opts).toBe(false);
  });
});
