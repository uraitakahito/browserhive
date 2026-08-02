/**
 * Getting a WACZ signed, and reporting honestly when it was not.
 *
 * The signature lives in `datapackage-digest.json` at the WACZ root and
 * follows wacz-auth 0.1.0. Producing it needs a private key, and the whole
 * point of asking a service for it is that the key is not here: this process
 * sends a hash and gets a signature back, and never holds anything that could
 * sign a second archive.
 *
 * A signature is optional, and that shapes the contract below: `sign` does not
 * throw. A signing service that is down, slow, or refusing a token is not a
 * failed capture — the archive is still worth keeping. What must not happen is
 * losing the fact that it went unsigned, so the outcome is returned rather than
 * logged and dropped.
 */
import { Buffer } from "node:buffer";
import { verifySignedData } from "./verify-signed-data.js";
import type {
  SignedData,
  TrustAnchors,
  VerificationChecks,
} from "./verify-signed-data.js";

/**
 * A signature was required and could not be obtained.
 *
 * Thrown by the packager rather than by `sign`, which keeps its contract: the
 * port reports, the caller decides. It carries the signer's own reason because
 * that is the only part that says what to fix — the endpoint that refused, the
 * timeout that elapsed.
 */
export class SigningRequiredError extends Error {
  constructor(reason: string) {
    super(`a signature was required and could not be obtained: ${reason}`);
    this.name = "SigningRequiredError";
  }
}

/** What became of the signature. Reported on the capture result. */
export interface SignatureReport {
  signed: boolean;
  /** Set when `signed` is false. One line, in the signer's own words. */
  reason?: string;
  /** Set when `signed` is true. The domain the certificate is issued for. */
  domain?: string;
  /**
   * Which checks ran, and how each came out.
   *
   * `signed: true` alone would say "we hold a signature" without saying how
   * hard that was tested — and that depends on the deployment. Without a trust
   * anchor there is nothing to check a chain against, so it reports `skipped`
   * rather than `ok`: an archive should not be credited with a check that
   * never happened.
   *
   * Absent when nothing was verified at all, which is the case for the two
   * stand-in signers below — they never had a response to check.
   */
  checks?: VerificationChecks;
}

export interface SignResult {
  /** `datapackage-digest.json` to add to the ZIP. Absent when unsigned. */
  digestBytes?: Buffer;
  report: SignatureReport;
}

export interface WaczSigner {
  /**
   * Sign `hash` — the `sha256:<hex>` of `datapackage.json`, exactly as it
   * appears in the file.
   *
   * Never throws. Reporting "there is no signature, and here is why" is this
   * port's job; letting the failure escape would push the same try/catch into
   * every caller and invite one of them to treat it as fatal.
   */
  sign(hash: string): Promise<SignResult>;
}

/**
 * The signer for captures that did not ask to be signed.
 *
 * Not a null object for convenience — it carries a reason, so a reader of the
 * report can tell "nobody asked" apart from "we asked and it failed".
 */
export const unsignedSigner: WaczSigner = {
  // eslint-disable-next-line @typescript-eslint/require-await -- async by contract: WaczSigner.sign returns a promise, and this one has nothing to await.
  sign: async () => ({ report: { signed: false, reason: "signing not requested" } }),
};

/**
 * The signer for captures that asked, on a deployment with nothing to ask.
 *
 * Distinct from `unsignedSigner` because the reason is the whole value here.
 * A capture that required a signature and failed reports this string, and
 * "signing not requested" would send whoever reads it to the request — which
 * did request one — instead of to the server that has no signing service
 * configured.
 */
export const noSigningServiceSigner: WaczSigner = {
  // eslint-disable-next-line @typescript-eslint/require-await -- async by contract: WaczSigner.sign returns a promise, and this one has nothing to await.
  sign: async () => ({
    report: { signed: false, reason: "no signing service is configured on this server" },
  }),
};

export interface HttpSignerOptions {
  /** The signing service's `/sign` endpoint. */
  url: string;
  /** Bearer token, when the service requires one. */
  token?: string;
  /**
   * Roots the returned signature is checked against.
   *
   * Either half may be absent; the matching check then reports `skipped`. An
   * empty object still verifies the signature and the domain — those need no
   * configuration, and they are what catch a service signing the wrong bytes.
   */
  anchors?: TrustAnchors;
  /**
   * How long to wait before giving up and going out unsigned.
   *
   * A signature is optional, so there is no version of this where holding the
   * capture open is the right trade. Whatever this is set to is the most a
   * signing service can cost a capture.
   */
  timeoutMs: number;
}

/**
 * `<url> — <what happened>`.
 *
 * The endpoint belongs in the reason because a deployment can have more than
 * one thing it might have been talking to, and because the most common cause
 * of an unsigned archive is that this address points at nothing.
 */
const describe = (url: string, what: string): string => `${url} — ${what}`;

/**
 * What actually went wrong, not what `fetch` calls it.
 *
 * `fetch` reports every transport problem as the string "fetch failed" and
 * puts the real one in `cause` — so "getaddrinfo ENOTFOUND capping.browserhive"
 * (the container is not running) and a mistyped URL arrive looking identical.
 *
 * That matters more here than it would elsewhere. A capture whose signature
 * fails still succeeds, so this line is frequently the only trace that
 * anything went wrong at all.
 */
const explain = (err: unknown): string => {
  if (!(err instanceof Error)) return String(err);
  return err.cause instanceof Error ? `${err.message}: ${err.cause.message}` : err.message;
};

/**
 * A signer that asks an authsign-shaped HTTP service.
 *
 * Every network concern lives in here — `fetch`, the timeout, the token, and
 * the catch. That is the whole reason the port exists: callers get a signature
 * or a reason, and never a decision about what an exception means.
 */
export const createHttpSigner = (options: HttpSignerOptions): WaczSigner => ({
  async sign(hash) {
    try {
      const res = await fetch(options.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.token === undefined
            ? {}
            : { authorization: `Bearer ${options.token}` }),
        },
        body: JSON.stringify({ hash }),
        signal: AbortSignal.timeout(options.timeoutMs),
      });

      if (!res.ok) {
        // The status is the diagnosis: 401 means the token is wrong, which is
        // a different fix from the service being down. Keep it in the reason.
        return { report: { signed: false, reason: describe(options.url, `returned ${String(res.status)}`) } };
      }

      const signedData = (await res.json()) as SignedData;
      if (typeof signedData.domain !== "string") {
        return { report: { signed: false, reason: describe(options.url, "returned no domain") } };
      }

      // Answering 200 says nothing about what was signed. Until this ran,
      // `signed: true` meant only that the shape looked right — a service
      // pointed at the wrong place produced archives that claimed a signature
      // nobody had checked.
      const verified = await verifySignedData({
        signedData,
        hash,
        anchors: options.anchors ?? {},
        timeoutMs: options.timeoutMs,
      });
      if (!verified.ok) {
        return {
          report: {
            signed: false,
            reason: describe(options.url, verified.reason ?? "signature did not verify"),
            checks: verified.checks,
          },
        };
      }

      // `hash` is ours, not the response's — the file has to describe the
      // datapackage we actually built, whatever the service echoed back.
      const digestBytes = Buffer.from(
        `${JSON.stringify({ path: "datapackage.json", hash, signedData }, null, 2)}\n`,
        "utf-8",
      );
      return {
        digestBytes,
        report: { signed: true, domain: signedData.domain, checks: verified.checks },
      };
    } catch (err) {
      // Timeout, DNS, connection refused, malformed JSON — all land here, and
      // all mean the same thing to the caller: carry on without a signature.
      return { report: { signed: false, reason: describe(options.url, explain(err)) } };
    }
  },
});
