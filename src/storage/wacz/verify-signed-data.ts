/**
 * Checking that a `signedData` is what it claims to be.
 *
 * A signing service answering 200 says nothing about what it signed. Four
 * things have to hold before an archive may call itself signed:
 *
 *   1. the signature verifies over *our* hash, under the leaf's key
 *   2. the leaf chains to a root this deployment trusts
 *   3. the certificate was issued for the domain the response names
 *   4. the timestamp token covers *this* signature
 *
 * Three of them are `node:crypto` — which is OpenSSL, in-process, no temp
 * files. The fourth is RFC 3161, which Node exposes no API for, so it is the
 * one check that shells out. Keeping that boundary around a single check is
 * the whole reason the split exists: a subprocess brings temp files, argument
 * handling, exit codes and a timeout with it, and three of these checks do not
 * need any of that.
 *
 * Nothing here throws. A malformed certificate, an unreadable token and a
 * forged signature are all the same answer to the caller — this signature
 * cannot be relied on, and here is which check said so.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { X509Certificate, verify as cryptoVerify } from "node:crypto";
import { Buffer } from "node:buffer";

const execFileAsync = promisify(execFile);

/**
 * The wacz-auth 0.1.0 payload, as far as verification needs it.
 *
 * Deliberately not the full shape: `created`, `software` and `version` are
 * recorded but nothing here checks them, and a type that promised otherwise
 * would be claiming more than the code does.
 */
export interface SignedData {
  hash: string;
  signature: string;
  domain: string;
  /** PEM chain, leaf first. */
  domainCert: string;
  /** base64 RFC 3161 response, over the base64 *text* of `signature`. */
  timeSignature?: string;
  /** PEM chain for the timestamp authority, leaf first. */
  timestampCert?: string;
  [key: string]: unknown;
}

/**
 * `ok` ran and passed, `failed` ran and did not, `skipped` never ran.
 *
 * The third state is not a convenience. Without a trust anchor there is
 * nothing to check a chain against, and reporting that as `ok` would credit
 * the archive with a check that never happened.
 */
export type CheckOutcome = "ok" | "failed" | "skipped";

export interface VerificationChecks {
  signature: CheckOutcome;
  chain: CheckOutcome;
  domain: CheckOutcome;
  timestamp: CheckOutcome;
}

export interface VerificationResult {
  /** True when no check failed. Skipped checks do not make it false. */
  ok: boolean;
  checks: VerificationChecks;
  /** Set when `ok` is false. Names the first check that failed, in its own words. */
  reason?: string;
}

/** Roots this deployment trusts. Either may be absent; the matching check is then skipped. */
export interface TrustAnchors {
  /** PEM. Verifies `domainCert`. */
  signing?: string;
  /** PEM. Verifies `timestampCert`. */
  timestamp?: string;
}

export interface VerifyInput {
  signedData: SignedData;
  /** The hash we computed, not the one the response echoed back. */
  hash: string;
  anchors: TrustAnchors;
  /** Upper bound on the one subprocess this makes. */
  timeoutMs?: number;
}

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

const DEFAULT_TIMEOUT_MS = 5_000;

const splitPemChain = (pem: string): X509Certificate[] =>
  (pem.match(PEM_BLOCK) ?? []).map((block) => new X509Certificate(block));

/**
 * Walk leaf → … → a certificate the anchor issued (or is).
 *
 * Each hop is checked both ways: `checkIssued` compares the names, `verify`
 * checks the signature. Names alone would accept anything that merely claims
 * the right issuer.
 */
const chainReaches = (chain: X509Certificate[], anchors: X509Certificate[]): boolean => {
  const issuedBy = (cert: X509Certificate, issuer: X509Certificate): boolean => {
    try {
      return cert.checkIssued(issuer) && cert.verify(issuer.publicKey);
    } catch {
      return false;
    }
  };

  for (let i = 0; i < chain.length; i += 1) {
    const cert = chain[i];
    if (cert === undefined) return false;
    if (anchors.some((anchor) => issuedBy(cert, anchor))) return true;
    const next = chain[i + 1];
    // A chain that does not hold together cannot reach anything, and saying so
    // here keeps the failure on the chain rather than on the anchor.
    if (next !== undefined && !issuedBy(cert, next)) return false;
  }
  return false;
};

/**
 * The instant a token says it was made, as seconds since the epoch.
 *
 * `undefined` when the token cannot be read at all — the caller then verifies
 * without `-attime`, which is the stricter of the two and fails anyway.
 */
const genTimeOf = async (tokenPath: string, timeoutMs: number): Promise<number | undefined> => {
  try {
    const { stdout } = await execFileAsync("openssl", ["ts", "-reply", "-in", tokenPath, "-text"], {
      timeout: timeoutMs,
    });
    const printed = /^Time stamp: (.+)$/m.exec(stdout)?.[1];
    if (printed === undefined) return undefined;
    const parsed = new Date(printed);
    return Number.isNaN(parsed.getTime()) ? undefined : Math.floor(parsed.getTime() / 1000);
  } catch {
    return undefined;
  }
};

/**
 * `openssl ts -verify`, the one thing Node cannot do.
 *
 * The token covers the base64 *text* of the signature, not its bytes — that is
 * capping's shape and py-wacz's, and getting it wrong makes a valid token look
 * forged.
 *
 * Verification happens as of the moment the token claims, not as of now. A
 * timestamp exists precisely to be checked after the fact, so a timestamping
 * certificate expiring must not invalidate what it signed while it was valid —
 * otherwise every archive here stops verifying on 2036-07-29 without a byte of
 * it having changed.
 *
 * What this does not do is establish that `genTime` is true. openssl checks the
 * certificate against whatever instant it is handed and no further, so a leaked
 * key could still mint a token backdated into its own validity window. That is
 * RFC 3161's standing limitation and wants an independent time source to close;
 * verifying at `genTime` is strictly better than verifying at `now`, which
 * prevents none of it while discarding every archive that outlives the CA.
 */
const verifyTimestamp = async (
  signedData: SignedData,
  timestampAnchor: string,
  timeoutMs: number,
): Promise<boolean> => {
  const dir = await mkdtemp(join(tmpdir(), "bh-ts-"));
  try {
    const token = join(dir, "token.tsr");
    const data = join(dir, "signature.b64");
    const root = join(dir, "root.pem");
    await Promise.all([
      writeFile(token, Buffer.from(signedData.timeSignature ?? "", "base64")),
      writeFile(data, signedData.signature, "utf-8"),
      writeFile(root, timestampAnchor, "utf-8"),
    ]);
    const at = await genTimeOf(token, timeoutMs);
    const argv = ["ts", "-verify", "-data", data, "-in", token, "-CAfile", root];
    if (at !== undefined) argv.push("-attime", String(at));
    await execFileAsync("openssl", argv, { timeout: timeoutMs });
    return true;
  } catch {
    // A non-zero exit, a missing binary and a timeout all mean the same thing
    // to the caller: this token could not be shown to cover this signature.
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

export const verifySignedData = async (input: VerifyInput): Promise<VerificationResult> => {
  const { signedData, hash, anchors } = input;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const checks: VerificationChecks = {
    signature: "failed",
    chain: "skipped",
    domain: "failed",
    timestamp: "skipped",
  };

  let chain: X509Certificate[];
  let leaf: X509Certificate | undefined;
  try {
    chain = splitPemChain(signedData.domainCert);
    leaf = chain[0];
  } catch (err) {
    return {
      ok: false,
      checks,
      reason: `signing certificate could not be parsed: ${String(err)}`,
    };
  }
  if (leaf === undefined) {
    return { ok: false, checks, reason: "signing certificate is missing" };
  }

  // 1. The signature, over the hash we computed rather than the one echoed.
  try {
    const signed = cryptoVerify(
      "sha256",
      Buffer.from(hash),
      leaf.publicKey,
      Buffer.from(signedData.signature, "base64"),
    );
    checks.signature = signed ? "ok" : "failed";
  } catch {
    checks.signature = "failed";
  }
  if (checks.signature === "failed") {
    return { ok: false, checks, reason: "signature does not cover this datapackage" };
  }

  // 2. The chain, when there is something to check it against.
  if (anchors.signing !== undefined) {
    let anchorCerts: X509Certificate[];
    try {
      anchorCerts = splitPemChain(anchors.signing);
    } catch {
      anchorCerts = [];
    }
    checks.chain = chainReaches(chain, anchorCerts) ? "ok" : "failed";
    if (checks.chain === "failed") {
      return { ok: false, checks, reason: "certificate chain does not reach a trusted root" };
    }
  }

  // 3. The domain the response names against the certificate that signed.
  checks.domain = leaf.checkHost(signedData.domain) === undefined ? "failed" : "ok";
  if (checks.domain === "failed") {
    return {
      ok: false,
      checks,
      reason: `certificate is not valid for ${signedData.domain}`,
    };
  }

  // 4. The timestamp — the only subprocess, and only when both halves exist.
  if (signedData.timeSignature !== undefined && anchors.timestamp !== undefined) {
    const covered = await verifyTimestamp(signedData, anchors.timestamp, timeoutMs);
    checks.timestamp = covered ? "ok" : "failed";
    if (!covered) {
      return { ok: false, checks, reason: "timestamp does not cover this signature" };
    }
  }

  return { ok: true, checks };
};

/**
 * Load the configured anchors, treating an unreadable file as absent.
 *
 * A missing anchor downgrades a check to `skipped`, which the archive records.
 * Refusing to start would be the stricter choice, but it belongs at startup
 * where the path is known — not here, where the only options are to carry on
 * or to fail every capture on the strength of a filesystem read.
 */
export const readTrustAnchors = (config: {
  trustAnchorPath?: string;
  timestampAnchorPath?: string;
}): TrustAnchors => {
  const read = (path: string | undefined): string | undefined => {
    if (path === undefined) return undefined;
    try {
      return readFileSync(path, "utf-8");
    } catch {
      return undefined;
    }
  };
  const signing = read(config.trustAnchorPath);
  const timestamp = read(config.timestampAnchorPath);
  return {
    ...(signing === undefined ? {} : { signing }),
    ...(timestamp === undefined ? {} : { timestamp }),
  };
};
