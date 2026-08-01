/**
 * Signing E2E: a real signature, from a real service, that really verifies.
 *
 * Everything up to here was faked. The packager tests use a fake signer, and
 * the HTTP signer tests use a stub that returns whatever the test wants. Those
 * pin down the wiring and the failure handling, and neither can tell you that
 * the bytes BrowserHive stores are a signature anyone could check.
 *
 * That is what this file is for, and it is the reason `test/fixtures/dev-ca`
 * is committed rather than generated: the trust root is the same in every
 * environment, so the assertion can be `capping verify --root …` instead of
 * the much weaker "a digest file appeared".
 *
 * The distinction matters because of the policy. A capture whose signature
 * fails still succeeds, so a signing setup that is entirely broken produces
 * green tests everywhere else. Only an assertion on the *success* path can
 * tell that this feature is alive.
 *
 * Requires the `signing` compose profile. Without it every capture here comes
 * back `signed: false`, which is correct behaviour and a failed test.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, inject, it } from "vitest";
import { scenarios } from "meadow";

import { captureRequest, submitAndWait, WACZ_ONLY } from "./helpers/capture.js";
import { fetchArtifact, makeS3, openWacz } from "./helpers/artifact.js";

const execFileAsync = promisify(execFile);

const api = inject("api");
const meadow = inject("meadow");
const s3 = makeS3(inject("s3"));

const ROOT = resolve(import.meta.dirname, "..", "..");
const DEV_CA = join(ROOT, "test", "fixtures", "dev-ca", "ca.crt");
const CAPPING_CLI = join(ROOT, "capping", "dist", "cli.js");

describe("a capture that asked to be signed", () => {
  it("carries a signature that capping verifies against the committed CA", async ({
    annotate,
  }) => {
    const url = meadow + scenarios.plainHtml;
    const report = await submitAndWait(
      api,
      captureRequest(url, { formats: WACZ_ONLY, signing: true }),
      annotate,
    );

    expect(report.status).toBe("success");

    // Fail loudly and specifically when the signing service is not up, rather
    // than letting the digest assertion below report a missing zip entry.
    if (report.signature?.signed !== true) {
      throw new Error(
        `expected a signature, got ${JSON.stringify(report.signature)} — ` +
          "is the stack up with `--profile signing`?",
      );
    }
    expect(report.signature.domain).toBe("sign.dev.local");

    const bytes = await fetchArtifact(s3, report.artifacts.wacz!);
    const entries = openWacz(bytes);
    expect(Object.keys(entries)).toContain("datapackage-digest.json");

    const digestText = Buffer.from(entries["datapackage-digest.json"]!).toString("utf-8");
    await annotate(digestText.slice(0, 200), "signature");

    // The signature has to cover the datapackage that is actually in this zip.
    // A digest over some other bytes verifies against nothing while looking
    // entirely correct.
    const digest = JSON.parse(digestText) as { path: string; hash: string };
    expect(digest.path).toBe("datapackage.json");

    const tmp = await mkdtemp(join(tmpdir(), "bh-signing-e2e-"));
    try {
      const digestPath = join(tmp, "datapackage-digest.json");
      await writeFile(digestPath, digestText, "utf8");

      // The only thing that checks the signature itself. waxlens compares the
      // hash and stops there.
      const { stdout } = await execFileAsync(process.execPath, [
        CAPPING_CLI,
        "verify",
        "--file",
        digestPath,
        "--root",
        DEV_CA,
      ]);
      await annotate(stdout.trim(), "capping verify");

      expect(stdout).toContain("valid");
      expect(stdout).not.toContain("FAILED");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("reports no signature at all when it did not ask", async ({ annotate }) => {
    const url = meadow + scenarios.plainHtml;
    const report = await submitAndWait(api, captureRequest(url, { formats: WACZ_ONLY }), annotate);

    expect(report.status).toBe("success");
    // Absent, not `{ signed: false }` — "nobody asked" and "we asked and it
    // failed" have to stay distinguishable.
    expect(report.signature).toBeUndefined();

    const entries = openWacz(await fetchArtifact(s3, report.artifacts.wacz!));
    expect(Object.keys(entries)).not.toContain("datapackage-digest.json");
  });
});

describe("asking to sign a capture with nothing to sign", () => {
  it("is refused at the API rather than quietly ignored", async () => {
    const res = await fetch(`${api}/v1/captures`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: meadow + scenarios.plainHtml,
        labels: ["e2e"],
        captureFormats: {
          png: true,
          webp: false,
          html: false,
          links: false,
          mhtml: false,
          wacz: false,
        },
        signing: true,
      }),
    });

    // Accepting this would produce a perfectly successful capture that is not
    // signed, with nothing to indicate the request was never satisfiable.
    expect(res.status).toBe(400);
  });
});
