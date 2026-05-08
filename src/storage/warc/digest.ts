/**
 * Content digest helpers for WARC records.
 *
 * WARC 1.1 specifies digest values as `<algorithm>:<base32-encoded-hash>`
 * (RFC 4648 base32 alphabet, **no padding**). `sha256` is the modern choice;
 * `sha1` is included for compatibility with older WARC consumers that have
 * not migrated yet — we do not emit `sha1` ourselves but expose the helper
 * for tests that compare against fixtures from existing WARC tooling.
 */
import { createHash } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * RFC 4648 base32 encode without padding. Uses `charAt` rather than indexing
 * so we don't trip `noUncheckedIndexedAccess` — the index is masked to 5
 * bits (∈ [0, 31]) and the alphabet has 32 characters, but the type system
 * can't prove that without an assertion.
 */
export const base32Encode = (bytes: Buffer): string => {
  let result = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32_ALPHABET.charAt((value >> bits) & 0x1f);
    }
  }
  if (bits > 0) {
    result += BASE32_ALPHABET.charAt((value << (5 - bits)) & 0x1f);
  }
  return result;
};

export const sha256Base32 = (data: Buffer): string => {
  const hash = createHash("sha256").update(data).digest();
  return `sha256:${base32Encode(hash)}`;
};

export const sha1Base32 = (data: Buffer): string => {
  const hash = createHash("sha1").update(data).digest();
  return `sha1:${base32Encode(hash)}`;
};

/**
 * `sha256:<hex>` — the format WACZ's `datapackage.json` uses for resource
 * file hashes. Distinct from the WARC digest format (`base32`, no padding)
 * because the two specs grew up independently — the same SHA-256 bytes are
 * emitted in different encodings depending on which file they appear in.
 */
export const sha256Hex = (data: Buffer): string => {
  const hash = createHash("sha256").update(data).digest("hex");
  return `sha256:${hash}`;
};
