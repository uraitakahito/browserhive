/**
 * Verifying what a signing service handed back.
 *
 * Until this existed, `signed: true` meant "the service answered 200 and the
 * JSON had a `domain` string". Nothing checked that the signature was over our
 * hash, that the certificate chained anywhere, or that the timestamp covered
 * anything — so a service pointed at the wrong place, or broken, produced
 * archives that claimed to be signed.
 *
 * The fixtures are real: `test/fixtures/signing/` holds a `signedData` capping
 * actually produced, with the roots that verify it. A placeholder would let a
 * verifier that always returns true pass every test here, which is why each
 * check is pinned in both directions — the good input, and the one mutation
 * that should defeat exactly that check and no other.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifySignedData } from "../../../src/storage/wacz/verify-signed-data.js";
import type { SignedData } from "../../../src/storage/wacz/verify-signed-data.js";

const FIXTURES = join(import.meta.dirname, "../../fixtures/signing");
const read = (name: string): string => readFileSync(join(FIXTURES, name), "utf-8");

const HASH = "sha256:0be7b2fea93622c434c8f205494e2d0b451acae3803dc87420b6ef51e151239c";

const fixture = (): SignedData =>
  JSON.parse(read("signed-data.json")) as SignedData;

const anchors = {
  signing: read("../dev-ca/insecure-dev-ca.crt"),
  timestamp: read("../dev-ca/insecure-dev-tsa-ca.crt"),
};

describe("verifySignedData — the happy path", () => {
  it("accepts the signature capping actually produced", async () => {
    const result = await verifySignedData({ signedData: fixture(), hash: HASH, anchors });

    expect(result.ok).toBe(true);
    expect(result.checks).toEqual({
      signature: "ok",
      chain: "ok",
      domain: "ok",
      timestamp: "ok",
    });
  });
});

describe("verifySignedData — signature", () => {
  it("rejects a valid signature that is not over this datapackage", async () => {
    // The test that matters most. The signature, the certificate and the chain
    // are all genuine — only the thing being signed is different, which is
    // exactly what a service signing the wrong bytes would look like.
    const result = await verifySignedData({
      signedData: fixture(),
      hash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      anchors,
    });

    expect(result.ok).toBe(false);
    expect(result.checks.signature).toBe("failed");
    expect(result.reason).toContain("signature");
  });

  it("rejects a tampered signature", async () => {
    const signedData = fixture();
    const bytes = Buffer.from(signedData.signature, "base64");
    bytes[bytes.length - 1] ^= 0xff;
    signedData.signature = bytes.toString("base64");

    const result = await verifySignedData({ signedData, hash: HASH, anchors });

    expect(result.ok).toBe(false);
    expect(result.checks.signature).toBe("failed");
  });
});

describe("verifySignedData — chain", () => {
  it("rejects a chain that does not reach the configured anchor", async () => {
    const result = await verifySignedData({
      signedData: fixture(),
      hash: HASH,
      anchors: { ...anchors, signing: read("other-ca.pem") },
    });

    expect(result.ok).toBe(false);
    expect(result.checks.chain).toBe("failed");
    // The signature itself is untouched, so only the chain should have moved.
    expect(result.checks.signature).toBe("ok");
  });

  it("reports the chain as skipped when no anchor is configured", async () => {
    // A deployment with no anchor still gets the other three checks. Calling
    // that `ok` would claim a check that never ran.
    const result = await verifySignedData({
      signedData: fixture(),
      hash: HASH,
      anchors: { timestamp: anchors.timestamp },
    });

    expect(result.ok).toBe(true);
    expect(result.checks.chain).toBe("skipped");
  });
});

describe("verifySignedData — domain", () => {
  it("rejects a domain the certificate was not issued for", async () => {
    const signedData = { ...fixture(), domain: "not-the-signer.example" };

    const result = await verifySignedData({ signedData, hash: HASH, anchors });

    expect(result.ok).toBe(false);
    expect(result.checks.domain).toBe("failed");
    expect(result.checks.signature).toBe("ok");
  });
});

describe("verifySignedData — timestamp", () => {
  it("rejects a genuine token that covers a different signature", async () => {
    // The token is real, issued by the same authority, and verifies in itself.
    // It just belongs to another signature — which is what swapping tokens
    // between archives would look like, and what corrupting the bytes would
    // not: a mangled token fails for being mangled, and proves less.
    //
    // Mutating the signature instead would defeat check 1 first and never
    // reach this one, so the substitution has to be on the token side.
    const signedData = { ...fixture(), timeSignature: read("other-time-signature.txt").trim() };

    const result = await verifySignedData({ signedData, hash: HASH, anchors });

    expect(result.ok).toBe(false);
    expect(result.checks.timestamp).toBe("failed");
    // Everything before it is untouched — the failure is where it belongs.
    expect(result.checks.signature).toBe("ok");
    expect(result.checks.chain).toBe("ok");
    expect(result.checks.domain).toBe("ok");
  });

  it("reports the timestamp as skipped when the service attached none", async () => {
    const withoutToken = fixture();
    delete withoutToken.timeSignature;

    const result = await verifySignedData({ signedData: withoutToken, hash: HASH, anchors });

    // wacz-auth makes the token optional, so its absence is not a failure —
    // but it is not an `ok` either, and the archive should be able to say so.
    expect(result.ok).toBe(true);
    expect(result.checks.timestamp).toBe("skipped");
  });

  it("reports the timestamp as skipped when no anchor is configured", async () => {
    const result = await verifySignedData({
      signedData: fixture(),
      hash: HASH,
      anchors: { signing: anchors.signing },
    });

    expect(result.ok).toBe(true);
    expect(result.checks.timestamp).toBe("skipped");
  });
});

describe("verifySignedData — malformed input", () => {
  it("fails rather than throws when the certificate is not a certificate", async () => {
    const signedData = { ...fixture(), domainCert: "-----BEGIN CERTIFICATE-----\nnope\n" };

    const result = await verifySignedData({ signedData, hash: HASH, anchors });

    expect(result.ok).toBe(false);
    expect(result.reason).toBeDefined();
  });
});
