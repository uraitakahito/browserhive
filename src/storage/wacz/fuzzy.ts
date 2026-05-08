/**
 * `fuzzy.json` builder for WACZ.
 *
 * Phase 6.4 deliverable: ship a forward-looking strip-rule file at the
 * WACZ root so replay engines that honour it (or BrowserHive's own viewer
 * docs) can match recorded responses against live JS-regenerated URLs.
 *
 * The file's job is to teach the replay engine: "treat these query
 * parameters as ignorable when looking up a response." For example, a
 * recorded request for `/api/data?_=1700000000000` should still match a
 * live replay request for `/api/data?_=1700000000999` once `_` is in the
 * fuzzy-strip set.
 *
 * **Status of replay-engine support today.** Most replay tools
 * (ReplayWeb.page / wabac.js) carry their own *built-in* cache-buster
 * heuristic, and the recorded archive does not need to teach them
 * anything for the common cases. This `fuzzy.json` is therefore a
 * documentation-style artifact — anyone who points a custom replay
 * pipeline at the WACZ can read it to see which params we considered
 * fuzzy at capture time. The schema is conservative (a small list of
 * strip-by-name rules) so future engines can adopt it without surprises.
 */

export interface FuzzyRule {
  /** Human-readable rule kind. We only emit `strip-query-param` today. */
  rule: "strip-query-param";
  /** Query parameter name to strip when comparing URLs. */
  name: string;
}

export interface FuzzyJsonInput {
  params: readonly string[];
}

/**
 * Build a `fuzzy.json` file body. Returns the bytes ready to embed in the
 * WACZ. Empty `params` produces a structurally valid (empty `rules` array)
 * file so callers don't need to special-case the disabled state.
 */
export const buildFuzzyJson = (input: FuzzyJsonInput): Buffer => {
  const rules: FuzzyRule[] = input.params.map((name) => ({
    rule: "strip-query-param",
    name,
  }));
  const body = {
    version: 1,
    rules,
  };
  return Buffer.from(`${JSON.stringify(body, null, 2)}\n`, "utf-8");
};
