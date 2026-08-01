/**
 * The HTTP signer, against a stub we control.
 *
 * No capping container here on purpose. What needs pinning down is how this
 * side behaves when the service misbehaves — refuses the token, never answers,
 * answers with something unexpected — and a stub produces those on demand far
 * more reliably than a real service can be made to.
 *
 * The contract under test is one sentence: `sign` never throws. Every failure
 * has to come back as `{ signed: false, reason }`, because the caller's only
 * correct response is to write the archive anyway.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createHttpSigner } from "../../../src/storage/wacz/signer.js";

const HASH = "sha256:0be7b2fea93622c434c8f205494e2d0b451acae3803dc87420b6ef51e151239c";

const servers: Server[] = [];

/** Start a stub on an OS-chosen port and return its `/sign` URL. */
const stub = async (
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<string> => {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/sign`;
};

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) => new Promise<void>((resolve) => s.close(() => { resolve(); })),
    ),
  );
});

const signedDataFixture = {
  hash: HASH,
  created: "2026-08-02T00:00:00.000Z",
  signature: "MEQCIGS0Ydsd",
  domain: "sign.dev.local",
  domainCert: "-----BEGIN CERTIFICATE-----\n…",
};

describe("createHttpSigner", () => {
  it("returns the signature and the domain that signed", async () => {
    const url = await stub((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(signedDataFixture));
    });

    const { digestBytes, report } = await createHttpSigner({ url, timeoutMs: 5000 }).sign(HASH);

    expect(report).toEqual({ signed: true, domain: "sign.dev.local" });
    expect(digestBytes).toBeDefined();

    // The shape wacz-auth expects at the WACZ root, and the hash we asked to
    // have signed — not some other hash the service felt like returning.
    const digest = JSON.parse(digestBytes!.toString("utf-8")) as {
      path: string;
      hash: string;
      signedData: { domain: string };
    };
    expect(digest.path).toBe("datapackage.json");
    expect(digest.hash).toBe(HASH);
    expect(digest.signedData.domain).toBe("sign.dev.local");
  });

  it("sends the bearer token only when one is configured", async () => {
    const seen: (string | undefined)[] = [];
    const url = await stub((req, res) => {
      seen.push(req.headers.authorization);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(signedDataFixture));
    });

    await createHttpSigner({ url, timeoutMs: 5000 }).sign(HASH);
    await createHttpSigner({ url, token: "dev-token", timeoutMs: 5000 }).sign(HASH);

    expect(seen).toEqual([undefined, "Bearer dev-token"]);
  });

  it("reports the status when the service refuses", async () => {
    const url = await stub((_req, res) => {
      res.writeHead(401);
      res.end();
    });

    const { digestBytes, report } = await createHttpSigner({ url, timeoutMs: 5000 }).sign(HASH);

    expect(report.signed).toBe(false);
    // The status is the whole diagnosis here — a 401 means the token is wrong,
    // which is a different fix from the service being down.
    expect(report.reason).toContain("401");
    expect(digestBytes).toBeUndefined();
  });

  it("gives up rather than holding the capture open", async () => {
    // A stub that accepts the request and then says nothing, ever.
    const url = await stub(() => {
      /* deliberately no response */
    });

    // Real timers, milliseconds. Fake timers do not reach inside `fetch`'s
    // abort plumbing, and a short real wait is cheaper than finding that out.
    const started = Date.now();
    const { report } = await createHttpSigner({ url, timeoutMs: 80 }).sign(HASH);
    const elapsed = Date.now() - started;

    expect(report.signed).toBe(false);
    expect(report.reason).toBeDefined();
    // Generous upper bound: the point is that it returned at all, well before
    // any capture-level timeout would have noticed.
    expect(elapsed).toBeLessThan(3000);
  });

  it("does not throw when the service answers with nonsense", async () => {
    const url = await stub((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("this is not json");
    });

    const { report } = await createHttpSigner({ url, timeoutMs: 5000 }).sign(HASH);

    expect(report.signed).toBe(false);
    expect(report.reason).toBeDefined();
  });

  it("does not throw when nothing is listening", async () => {
    // Port 1 on loopback: reserved, and nothing this test could have started.
    const { report } = await createHttpSigner({
      url: "http://127.0.0.1:1/sign",
      timeoutMs: 1000,
    }).sign(HASH);

    expect(report.signed).toBe(false);
    expect(report.reason).toBeDefined();
  });
});
