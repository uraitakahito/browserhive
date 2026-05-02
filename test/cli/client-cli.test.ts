import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { vi } from "vitest";
import { parseClientOptions } from "../../src/cli/client-cli.js";
import {
  CLIENT_ENV_VARS,
  setupCliTestEnv,
  teardownCliTestEnv,
  ProcessExitError,
} from "../helpers/cli-env.js";

const argv = (...rest: string[]): string[] => ["node", "csv-client", ...rest];

describe("client-cli parseClientOptions", () => {
  beforeEach(() => {
    setupCliTestEnv(CLIENT_ENV_VARS);
  });
  afterEach(() => {
    teardownCliTestEnv();
  });

  it("CLI 引数の --csv だけで既定値が組み立つ", () => {
    const opts = parseClientOptions(argv("--csv", "data/urls.csv"));
    expect(opts.server).toBe("localhost:50051");
    expect(opts.csv).toBe("data/urls.csv");
    expect(opts.tlsCaCert).toBeUndefined();
  });

  it("BROWSERHIVE_SERVER で --server を上書きできる", () => {
    vi.stubEnv("BROWSERHIVE_SERVER", "browserhive.internal:51000");
    const opts = parseClientOptions(argv("--csv", "data/urls.csv"));
    expect(opts.server).toBe("browserhive.internal:51000");
  });

  it("CLI の --server が env を上書きする", () => {
    vi.stubEnv("BROWSERHIVE_SERVER", "browserhive.internal:51000");
    const opts = parseClientOptions(
      argv("--csv", "data/urls.csv", "--server", "127.0.0.1:9000"),
    );
    expect(opts.server).toBe("127.0.0.1:9000");
  });

  it("BROWSERHIVE_TLS_CA_CERT が tlsCaCert に反映される", () => {
    vi.stubEnv("BROWSERHIVE_TLS_CA_CERT", "/etc/ca.pem");
    const opts = parseClientOptions(argv("--csv", "data/urls.csv"));
    expect(opts.tlsCaCert).toBe("/etc/ca.pem");
  });

  it("--csv が CLI 必須なので未指定だと exit する", () => {
    expect(() => parseClientOptions(argv())).toThrow(ProcessExitError);
  });
});
