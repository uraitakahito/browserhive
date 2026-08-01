/**
 * What BrowserHive implements of the specs it writes to, as data.
 *
 * The single source for `docs-site/.../spec-coverage.md` (en + ja). Kept as a
 * table rather than prose because a page like this is only worth having if it
 * is true, and a hand-maintained list of what the code emits stops being true
 * the first time someone adds a field. `build-spec-coverage.test.ts` renders it
 * and checks the `implemented` claims against the code that does the emitting.
 *
 * Four states, and the distinction between the last two is the point of the
 * page:
 *   - `implemented`      — emitted as the spec describes.
 *   - `implemented-plus` — emitted as the spec describes, *and* supplemented
 *                          because the spec's own form cannot carry everything
 *                          we know. Recorded separately so nobody deletes the
 *                          supplement as redundant.
 *   - `unused`           — not emitted. Says why not.
 *   - `divergent`        — the spec offers a way and we took another. Says why,
 *                          with the source that justifies it.
 */

export type CoverageState = "implemented" | "implemented-plus" | "unused" | "divergent";

export interface CoverageItem {
  item: string;
  state: CoverageState;
  /** Why — one line. Required even for `implemented`, where it says what it carries. */
  en: string;
  ja: string;
}

export interface CoverageArea {
  /** Stable id — the generated heading anchor. */
  id: string;
  titleEn: string;
  titleJa: string;
  /** Which document defines this surface. */
  specEn: string;
  specJa: string;
  items: CoverageItem[];
}

export const COVERAGE: CoverageArea[] = [
  {
    id: "wacz-layout",
    titleEn: "WACZ file layout",
    titleJa: "WACZ のファイル構成",
    specEn: "WACZ 1.1.1 — WACZ Object",
    specJa: "WACZ 1.1.1 — WACZ Object",
    items: [
      {
        item: "archive/data.warc.gz",
        state: "implemented",
        en: "One gzipped WARC per capture.",
        ja: "キャプチャごとに gzip 圧縮した WARC を 1 本。",
      },
      {
        item: "indexes/index.cdxj",
        state: "implemented",
        en: "Plain CDXJ, one line per response record.",
        ja: "素の CDXJ。response レコード 1 本につき 1 行。",
      },
      {
        item: "indexes/index.idx (ZipNum)",
        state: "divergent",
        en: "The spec allows a gzipped, clustered index. wabac.js cannot read it, and replay is the point of producing a WACZ at all.",
        ja: "仕様は gzip 圧縮したクラスタ索引を認めるが、wabac.js が読めない。WACZ を作る目的が replay である以上、読めない形は採れない。",
      },
      {
        item: "pages/pages.jsonl",
        state: "implemented",
        en: "Header line plus one entry — a capture is one page.",
        ja: "ヘッダ行 ＋ 1 エントリ。1 キャプチャ = 1 ページのため。",
      },
      {
        item: "pages/extraPages.jsonl",
        state: "unused",
        en: "For crawl-discovered pages. A capture has exactly one page, so there is nothing to put here.",
        ja: "クロールで発見したページ用。1 キャプチャ 1 ページなので入れるものがない。",
      },
      {
        item: "datapackage.json",
        state: "implemented",
        en: "Frictionless data package manifest with a hash per resource.",
        ja: "Frictionless data package のマニフェスト。リソースごとにハッシュを持つ。",
      },
      {
        item: "datapackage-digest.json",
        state: "unused",
        en: "The hook signing hangs on. Nothing signs a capture yet, so an unsigned digest would only add a file.",
        ja: "署名がぶら下がる場所。まだ何も署名していないため、未署名の digest はファイルが増えるだけになる。",
      },
      {
        item: "fuzzy.json (non-spec)",
        state: "divergent",
        en: "Not in the spec. The spec permits extra files at the root, and wabac.js reads this one for fuzzy URL matching on replay.",
        ja: "仕様に無い。仕様はルートへの追加ファイルを認めており、wabac.js が replay 時の曖昧 URL 照合に読む。",
      },
    ],
  },
  {
    id: "warc-record-types",
    titleEn: "WARC record types",
    titleJa: "WARC のレコード種別",
    specEn: "WARC 1.1 (ISO 28500) §5",
    specJa: "WARC 1.1 (ISO 28500) §5",
    items: [
      {
        item: "warcinfo",
        state: "implemented",
        en: "One per WARC, carrying software / format / conformsTo.",
        ja: "WARC ごとに 1 本。software・format・conformsTo を持つ。",
      },
      {
        item: "request",
        state: "implemented",
        en: "Paired with its response through WARC-Concurrent-To.",
        ja: "WARC-Concurrent-To で response と対にする。",
      },
      {
        item: "response",
        state: "implemented",
        en: "Status line, headers and body as an HTTP/1.1 message.",
        ja: "ステータス行・ヘッダ・本文を HTTP/1.1 メッセージとして格納。",
      },
      {
        item: "metadata",
        state: "implemented",
        en: "Records why a body is missing, so a dropped URL is never silently absent.",
        ja: "本文が無い理由を記録する。落とした URL が黙って消えないようにするため。",
      },
      {
        item: "resource",
        state: "unused",
        en: "For content not fetched over HTTP — DNS lookups are the usual case. Chromium's DevTools Protocol does not expose the resolver's answers.",
        ja: "HTTP 以外で取得した内容用で、代表例は DNS。Chromium の DevTools Protocol はリゾルバの結果を出さない。",
      },
      {
        item: "revisit",
        state: "unused",
        en: "For a payload already stored elsewhere. Each capture writes its own WARC and never dedupes across them.",
        ja: "既に別の場所にある payload 用。キャプチャごとに独立した WARC を書き、跨いだ重複排除をしない。",
      },
      {
        item: "conversion",
        state: "unused",
        en: "For a re-encoded copy of another record. Nothing is transformed after capture.",
        ja: "他レコードを再エンコードした複製用。キャプチャ後に変換を行わない。",
      },
      {
        item: "continuation",
        state: "unused",
        en: "For a record split across files. Everything for one capture goes in one WARC.",
        ja: "ファイルを跨いで分割したレコード用。1 キャプチャは 1 本の WARC に収める。",
      },
    ],
  },
  {
    id: "warc-fields",
    titleEn: "WARC header fields",
    titleJa: "WARC のヘッダフィールド",
    specEn: "WARC 1.1 (ISO 28500) §5",
    specJa: "WARC 1.1 (ISO 28500) §5",
    items: [
      {
        item: "WARC-Record-ID",
        state: "implemented",
        en: "urn:uuid, allocated before the response arrives so request and response can point at each other.",
        ja: "urn:uuid。response 到着前に採番し、request と相互に指せるようにする。",
      },
      { item: "WARC-Type", state: "implemented", en: "One of the four types above.", ja: "上記 4 種別のいずれか。" },
      {
        item: "WARC-Date",
        state: "implemented",
        en: "Millisecond precision, which WARC 1.1 permits. Note this is when the record was written, not when the exchange happened.",
        ja: "WARC 1.1 が認めるミリ秒精度。ただしこれは通信時刻ではなく、レコードを書いた時刻。",
      },
      { item: "WARC-Target-URI", state: "implemented", en: "The URL the record is about.", ja: "そのレコードが対象とする URL。" },
      { item: "Content-Type", state: "implemented", en: "application/http;msgtype=… or application/warc-fields.", ja: "application/http;msgtype=… または application/warc-fields。" },
      { item: "Content-Length", state: "implemented", en: "Byte length of the record block as stored.", ja: "保存したレコードブロックのバイト長。" },
      { item: "WARC-Block-Digest", state: "implemented", en: "sha256, base32, over the whole block.", ja: "ブロック全体の sha256（base32）。" },
      {
        item: "WARC-Payload-Digest",
        state: "implemented",
        en: "sha256, base32, over the body — including the empty body of a response whose payload was dropped.",
        ja: "本文の sha256（base32）。本文を落とした response の空ボディも対象にする。",
      },
      { item: "WARC-Concurrent-To", state: "implemented", en: "Links request, response and metadata from one capture event.", ja: "同一キャプチャの request・response・metadata を結ぶ。" },
      {
        item: "WARC-IP-Address",
        state: "implemented",
        en: "The address actually contacted. Stronger evidence than a name lookup: it survives DNS changes and CDN switches.",
        ja: "実際に接続したアドレス。名前解決の記録より強い証跡で、DNS 変更や CDN 切替の後も残る。",
      },
      { item: "WARC-Filename", state: "implemented", en: "On the warcinfo record.", ja: "warcinfo レコードに付与。" },
      { item: "WARC-Refers-To", state: "implemented", en: "Points a metadata record at the response it explains.", ja: "metadata レコードから、説明対象の response を指す。" },
      {
        item: "WARC-Truncated",
        state: "implemented-plus",
        en: "`length` when a size cap dropped a body. Supplemented by a metadata record: the field's four enumerated values cannot say how large the body was, or which cap fired.",
        ja: "上限で本文を落としたとき `length` を出す。metadata レコードで補完する — 列挙 4 値では元のサイズも、どちらの上限かも表せないため。",
      },
      {
        item: "WARC-Warcinfo-ID",
        state: "unused",
        en: "Links a record back to its warcinfo. There is exactly one warcinfo per file, so the link carries no information.",
        ja: "レコードから warcinfo への逆リンク。1 ファイルに warcinfo は 1 本しかないため情報量がない。",
      },
      {
        item: "WARC-Profile",
        state: "unused",
        en: "Only meaningful on revisit records, which are unused.",
        ja: "revisit レコードでのみ意味を持つが、そちらが未使用。",
      },
      {
        item: "WARC-Identified-Payload-Type",
        state: "unused",
        en: "The writer's own sniffed type, as opposed to the declared one. Nothing sniffs.",
        ja: "宣言された型ではなく、書き手が判別した型。判別処理を行っていない。",
      },
      { item: "WARC-Refers-To-Target-URI", state: "unused", en: "Revisit-only.", ja: "revisit 専用。" },
      { item: "WARC-Refers-To-Date", state: "unused", en: "Revisit-only.", ja: "revisit 専用。" },
      { item: "WARC-Segment-Number", state: "unused", en: "Segmentation is unused — one capture, one file.", ja: "分割を使わない（1 キャプチャ 1 ファイル）。" },
      { item: "WARC-Segment-Origin-ID", state: "unused", en: "Segmentation is unused.", ja: "分割を使わない。" },
      { item: "WARC-Segment-Total-Length", state: "unused", en: "Segmentation is unused.", ja: "分割を使わない。" },
    ],
  },
  {
    id: "cdxj",
    titleEn: "CDXJ index",
    titleJa: "CDXJ 索引",
    specEn: "CDXJ 0.1.0",
    specJa: "CDXJ 0.1.0",
    items: [
      { item: "url", state: "implemented", en: "Required.", ja: "必須。" },
      {
        item: "digest",
        state: "implemented",
        en: "Required. Present on every line, including responses that stored no body — zero bytes hash to a defined value.",
        ja: "必須。本文を保存しなかった response も含め全行にある — 0 バイトのハッシュは定義されている。",
      },
      { item: "mime", state: "implemented", en: "Required.", ja: "必須。" },
      { item: "filename", state: "implemented", en: "Required. Relative to archive/, as pywb and wacz-creator write it.", ja: "必須。pywb・wacz-creator と同じく archive/ からの相対。" },
      { item: "offset", state: "implemented", en: "Required. Emitted as a string, per the reference producers.", ja: "必須。参照実装に合わせて文字列で出す。" },
      { item: "length", state: "implemented", en: "Required. Emitted as a string.", ja: "必須。文字列で出す。" },
      { item: "status", state: "implemented", en: "Required. Emitted as a string.", ja: "必須。文字列で出す。" },
      {
        item: "recordDigest",
        state: "unused",
        en: "Appears in the spec's example but not in its list of required properties. Nothing reads it.",
        ja: "仕様の例には出るが、必須プロパティの一覧には無い。読み手もいない。",
      },
    ],
  },
  {
    id: "pages-jsonl",
    titleEn: "pages.jsonl",
    titleJa: "pages.jsonl",
    specEn: "WACZ 1.1.1 — pages.jsonl",
    specJa: "WACZ 1.1.1 — pages.jsonl",
    items: [
      { item: "url (MUST)", state: "implemented", en: "The captured page.", ja: "キャプチャしたページ。" },
      {
        item: "ts (MUST)",
        state: "implemented",
        en: "Replay pins its clock shims to this, so JS that bakes Date.now() into a URL re-emits the same URL.",
        ja: "replay の時計 shim がこの値に固定される。Date.now() を URL に埋める JS が同じ URL を再生成できる。",
      },
      { item: "title (MAY)", state: "implemented", en: "The page's <title>.", ja: "ページの <title>。" },
      { item: "id (MAY)", state: "implemented", en: "The BrowserHive task id, so logs cross-reference.", ja: "BrowserHive のタスク ID。ログと突き合わせられる。" },
      {
        item: "text (MAY)",
        state: "unused",
        en: "Extracted page text, for full-text search over an archive. Nothing here searches.",
        ja: "アーカイブ全文検索用の抽出テキスト。検索機能が無い。",
      },
      {
        item: "size (MAY)",
        state: "unused",
        en: "Total bytes of the page and its resources. Already reported per capture in waczStats.",
        ja: "ページと全リソースの合計バイト数。キャプチャ単位では waczStats が既に報告している。",
      },
    ],
  },
  {
    id: "datapackage",
    titleEn: "datapackage.json",
    titleJa: "datapackage.json",
    specEn: "WACZ 1.1.1 — datapackage.json",
    specJa: "WACZ 1.1.1 — datapackage.json",
    items: [
      { item: "profile (MUST)", state: "implemented", en: 'The literal "data-package".', ja: '文字列 "data-package"。' },
      { item: "resources (MUST)", state: "implemented", en: "name / path / hash / bytes for every file in the package.", ja: "パッケージ内の全ファイルの name・path・hash・bytes。" },
      { item: "wacz_version (MUST)", state: "implemented", en: '"1.1.1".', ja: '"1.1.1"。' },
      { item: "title (SHOULD)", state: "implemented", en: "The page title, falling back to its URL.", ja: "ページタイトル。無ければ URL。" },
      { item: "created (SHOULD)", state: "implemented", en: "When the WACZ was assembled.", ja: "WACZ を組み立てた日時。" },
      { item: "software (SHOULD)", state: "implemented", en: "browserhive plus the released version.", ja: "browserhive とリリース版数。" },
      { item: "mainPageDate (SHOULD)", state: "implemented", en: "When the page was captured.", ja: "ページをキャプチャした日時。" },
      {
        item: "mainPageUrl (SHOULD)",
        state: "divergent",
        en: "Written as `mainPageURL`. wabac.js reads that spelling; the spec's is `mainPageUrl`, and 1.2.0 drops the property entirely. Replay wins here.",
        ja: "`mainPageURL` と書いている。wabac.js がその綴りを読むため。仕様の綴りは `mainPageUrl` で、1.2.0 では削除された。ここは replay を優先している。",
      },
      {
        item: "description (SHOULD)",
        state: "unused",
        en: "A longer prose description. A capture has no editorial description to give.",
        ja: "長めの説明文。キャプチャに付ける編集的な説明が存在しない。",
      },
      {
        item: "modified (SHOULD)",
        state: "unused",
        en: "A WACZ is written once and never edited, so it equals `created`.",
        ja: "WACZ は一度書いたら編集しないため `created` と同値になる。",
      },
    ],
  },
  {
    id: "wacz-auth",
    titleEn: "Signing (wacz-auth)",
    titleJa: "署名 (wacz-auth)",
    specEn: "WACZ Signing and Verification 0.1.0",
    specJa: "WACZ Signing and Verification 0.1.0",
    items: [
      {
        item: "Anonymous Signature",
        state: "unused",
        en: "Signs the digest with a bare key pair. Verification then needs the public key distributed some other way.",
        ja: "鍵ペアだけで digest に署名する。検証には公開鍵を別経路で配る必要がある。",
      },
      {
        item: "Domain-Ownership Identity + Signed Timestamp",
        state: "unused",
        en: "Signs with a domain's TLS key and countersigns with an RFC 3161 timestamp. Needs a certificate for a domain BrowserHive controls, and a timestamp authority.",
        ja: "ドメインの TLS 鍵で署名し、RFC 3161 タイムスタンプで副署する。BrowserHive が管理するドメインの証明書と、タイムスタンプ局が要る。",
      },
    ],
  },
];
