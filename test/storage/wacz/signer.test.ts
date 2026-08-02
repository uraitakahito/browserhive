/**
 * The HTTP signer, against a stub we control.
 *
 * No capping container here on purpose. What needs pinning down is how this
 * side behaves when the service misbehaves — refuses the token, never answers,
 * answers with something unexpected — and a stub produces those on demand far
 * more reliably than a real service can be made to.
 *
 * The contract under test is one sentence: `sign` never throws. Every failure
 * has to come back as `{ signed: false, reason }`, because what a failure means
 * is not this layer's call — a capture that required a signature fails on it,
 * one that did not is written unsigned, and the port cannot tell them apart.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import {
  createHttpSigner,
  noSigningServiceSigner,
  unsignedSigner,
} from "../../../src/storage/wacz/signer.js";

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

/**
 * A `signedData` capping actually produced, not a hand-written stand-in.
 *
 * It used to be a placeholder — `domainCert: "-----BEGIN CERTIFICATE-----\n…"`,
 * literally. That was fine while nothing verified it, and became a liability
 * the moment something did: a verifier tested against an unverifiable fixture
 * proves nothing, and the red it produces looks like a bug in the verifier
 * rather than in the fixture.
 */
const FIXTURE_DIR = join(import.meta.dirname, "../../fixtures/signing");
const readFixture = (name: string): string => readFileSync(join(FIXTURE_DIR, name), "utf-8");
const signedDataFixture = JSON.parse(readFixture("signed-data.json")) as {
  hash: string;
  domain: string;
};

describe("createHttpSigner", () => {
  it("returns the signature and the domain that signed", async () => {
    const url = await stub((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(signedDataFixture));
    });

    const { digestBytes, report } = await createHttpSigner({ url, timeoutMs: 5000 }).sign(HASH);

    // No anchors configured here, so the two checks that need one are
    // `skipped` — the other two hold regardless, and they are the ones that
    // catch a service signing the wrong bytes.
    expect(report).toEqual({
      signed: true,
      domain: "sign.dev.local",
      checks: { signature: "ok", chain: "skipped", domain: "ok", timestamp: "skipped" },
    });
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

  it("reports the status and the endpoint when the service refuses", async () => {
    const url = await stub((_req, res) => {
      res.writeHead(401);
      res.end();
    });

    const { digestBytes, report } = await createHttpSigner({ url, timeoutMs: 5000 }).sign(HASH);

    expect(report.signed).toBe(false);
    // The status is the whole diagnosis here — a 401 means the token is wrong,
    // which is a different fix from the service being down.
    expect(report.reason).toContain("401");
    // And which service, because a deployment can have more than one thing it
    // could have been talking to.
    expect(report.reason).toContain(url);
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

  it("does not throw when nothing is listening, and says what went wrong", async () => {
    // A high loopback port with nothing on it. Not port 1 — `fetch` refuses
    // that one itself as a "bad port", which is a different failure and never
    // reaches the socket.
    const url = "http://127.0.0.1:45999/sign";
    const { report } = await createHttpSigner({ url, timeoutMs: 2000 }).sign(HASH);

    expect(report.signed).toBe(false);
    expect(report.reason).toContain(url);

    // `fetch` reports every transport problem as the same three words and puts
    // the real one in `cause`. Dropping it leaves "fetch failed", which cannot
    // distinguish a stopped container from a typo in the URL — and with a
    // policy of carrying on unsigned, that line is often the only trace there
    // is.
    expect(report.reason).not.toBe("fetch failed");
    expect(report.reason).toMatch(/ECONNREFUSED|ENOTFOUND|connect/i);
  });

  it("names the host when the service's DNS name does not resolve", async () => {
    // The exact shape of "the container is not running" in the dev stack.
    const url = "http://capping.invalid.localdomain:8080/sign";
    const { report } = await createHttpSigner({ url, timeoutMs: 3000 }).sign(HASH);

    expect(report.signed).toBe(false);
    expect(report.reason).toContain("capping.invalid.localdomain");
  });
});

/**
 * The two stand-in signers.
 *
 * Both report `signed: false`, and the reason is the only thing telling them
 * apart. That matters more now than it did: with a signature required, this
 * string is what a failed capture says about itself, and "signing not
 * requested" on a capture that plainly requested one sends the reader looking
 * in the wrong place.
 */
describe("stand-in signers", () => {
  it("says nobody asked when nobody asked", async () => {
    const { digestBytes, report } = await unsignedSigner.sign(HASH);
    expect(digestBytes).toBeUndefined();
    expect(report).toEqual({ signed: false, reason: "signing not requested" });
  });

  it("names the missing service rather than blaming the request", async () => {
    const { report } = await noSigningServiceSigner.sign(HASH);
    expect(report.signed).toBe(false);
    expect(report.reason).toContain("no signing service");
  });
});

/**
 * Verification, through the port.
 *
 * The service is a stub here and the payload is the real fixture, so what is
 * under test is the wiring: does a response that does not verify come back as
 * `signed: false`, and does the report say which check said so.
 */
describe("createHttpSigner — verification", () => {
  const REAL_HASH = HASH;
  const realSignedData = (): unknown =>
    JSON.parse(readFixture("signed-data.json")) as unknown;
  const anchors = {
    signing: readFixture("../dev-ca/insecure-dev-ca.crt"),
    timestamp: readFixture("../dev-ca/insecure-dev-tsa-ca.crt"),
  };

  it("reports every check when the signature verifies", async () => {
    const url = await stub((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(realSignedData()));
    });

    const out = await createHttpSigner({ url, timeoutMs: 2000, anchors }).sign(REAL_HASH);

    expect(out.report.signed).toBe(true);
    expect(out.report.checks).toEqual({
      signature: "ok",
      chain: "ok",
      domain: "ok",
      timestamp: "ok",
    });
    expect(out.digestBytes).toBeDefined();
  });

  it("refuses a signature that is not over the hash we sent", async () => {
    const url = await stub((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(realSignedData()));
    });

    // The service returns a genuine signature — over somebody else's bytes.
    // Before verification existed this produced `signed: true`.
    const out = await createHttpSigner({ url, timeoutMs: 2000, anchors }).sign(
      "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    );

    expect(out.report.signed).toBe(false);
    expect(out.report.checks?.signature).toBe("failed");
    expect(out.digestBytes).toBeUndefined();
  });

  it("verifies nothing it was given no anchors for, and says so", async () => {
    const url = await stub((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(realSignedData()));
    });

    const out = await createHttpSigner({ url, timeoutMs: 2000, anchors: {} }).sign(REAL_HASH);

    // The signature and the domain still hold — those need no configuration.
    expect(out.report.signed).toBe(true);
    expect(out.report.checks).toEqual({
      signature: "ok",
      chain: "skipped",
      domain: "ok",
      timestamp: "skipped",
    });
  });
});
