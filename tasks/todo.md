# MinIO ストレージ対応

waggle 等の他サービスからアウトプットファイルを取りに行きやすくするため、PNG/JPEG/HTML/links/PDF の保存先をローカル FS / S3 互換ストア（MinIO 等）の二択に切り替えられるようにする。`local` ↔ `s3` は排他。後方互換性は不要。

## Phase 1 — ストレージ抽象化レイヤ導入（無挙動変更）

- [ ] `src/storage/types.ts` に `ArtifactStore` / `ArtifactContentType` 定義
- [ ] `src/storage/local-store.ts` に `LocalArtifactStore`（既存 writeFile 同等）
- [ ] `src/storage/index.ts` barrel
- [ ] `src/capture/types.ts`: `pngPath` 等を `pngLocation` 等にリネーム
- [ ] `src/capture/page-capturer.ts`: `store: ArtifactStore` を受け取り、`writeFile` 直叩きを `store.put` に置換
- [ ] `src/capture/browser-client.ts`: コンストラクタで store を受け取り、PageCapturer に渡す
- [ ] `src/capture/coordinator-machine.ts`: input/context に `store` を持たせ、worker spawn 時に渡す
- [ ] `src/capture/capture-coordinator.ts`: `LocalArtifactStore` を生成、`initialize()` を呼ぶ
- [ ] `src/capture/worker-loop.ts`: ログのフィールド名を `*Location` に
- [ ] テスト更新: pdf/links/redirect/dismiss 系の `pdfPath` 等の参照を新名に変更、browser-client.test.ts のモック CaptureResult を更新
- [ ] `npm run lint && npm test` グリーン

## Phase 2 — 設定/CLI 再構成

- [ ] `src/config/types.ts`: `StorageConfig` discriminated union を導入、`CaptureConfig.outputDir` を `CaptureConfig.storage` に置換
- [ ] `src/config/defaults.ts`: 既定 `storage = { kind: "local", outputDir: "" }`
- [ ] `src/cli/server-cli.ts`: `--storage <local|s3>` 必須化、`--output-dir`、`--s3-*` 群、排他バリデーション、secret マスクログ
- [ ] `src/capture/capture-coordinator.ts`: `kind === "s3"` で `throw new Error("S3 storage not yet implemented")`
- [ ] `compose.dev.yaml` / `compose.prod.yaml`: `BROWSERHIVE_STORAGE=local` を追加
- [ ] テスト: `test/cli/server-cli.test.ts` に kind 別ケースを追加
- [ ] `npm run lint && npm test` グリーン

## Phase 3 — `S3ArtifactStore` 実装

- [ ] `package.json`: `@aws-sdk/client-s3` を dep に追加 + `aws-sdk-client-mock` を devDep
- [ ] `src/storage/s3-store.ts`: `S3ArtifactStore`（HeadBucket fail-fast、PutObject、`s3://bucket/key` を返却）
- [ ] `src/capture/capture-coordinator.ts`: stub を外して `S3ArtifactStore` を生成
- [ ] テスト: `test/storage/s3-store.test.ts` をユニットレベルで追加（aws-sdk-client-mock）
- [ ] `Dockerfile.prod.dockerignore`: 新規 root ファイルを追加していないか再確認
- [ ] `npm run lint && npm test` グリーン

## Phase 4 — Docker / docs / 運用整備

- [ ] `compose.dev.yaml`: `minio` サービス + `mc mb` init + compose profiles で `local` / `s3` 切替
- [ ] `compose.prod.yaml`: 既定は local のまま、コメントで s3 用 env 例を追記
- [ ] `README.md`: `Storage backends` セクション追加（local 既定、s3 設定例、MinIO 起動例）
- [ ] dev compose で MinIO を立てて `data-client` 経由のスモーク確認

## レビュー欄

- Phase 1 commit: `b8deace` — ArtifactStore 抽象、LocalArtifactStore、`*Path` → `*Location` リネーム。挙動変更なし。
- Phase 2 commit: `3ec027e` — `StorageConfig` discriminated union、`--storage <local|s3>` 必須化、排他バリデーション、secret マスク。tests 465 → グリーン。
- Phase 3 commit: `d98ee56` — `S3ArtifactStore` 実装（`@aws-sdk/client-s3`）、aws-sdk-client-mock テスト 6 本追加。tests 471 → グリーン。
- Phase 4 commit: 本コミット — `compose.dev.s3.yaml` overlay (MinIO + `mc mb` init container)、README に Storage backends セクション、本番 compose のコメント。
- 実 MinIO スモーク: `S3ArtifactStore.initialize` (HeadBucket) → OK。`put` ×3（PNG/HTML/JSON）→ `s3://browserhive/smoke/...` URI を返却し、`mc ls` で実体を確認。クリーンアップ済。
- 全 build / lint / test グリーン (471 tests / 27 files)。
- 既知の未対応:
  - 多形式アップロードの並列化は逐次のまま（plan に従い別 PR）。
  - S3 PutObject 用の per-call timeout（Layer A）は未追加。Layer B (`taskTotal=100s`) でカバー。
  - バケット自動作成は未実装（インフラは外出し方針）。

---

# ローカル FS サポート削除（S3 専用化）

`local` / `s3` 二択を `s3` のみに縮約して複雑性と保守コストを下げる。破壊的変更で OK、後方互換不要、既存コンテナ／ボリュームは破棄可。`waggle` 等下流が S3 URI 前提で揃うのが自然な流れ。

## 設計判断（確定）

- `ArtifactStore` インターフェース層は**残す**。テストの `FakeArtifactStore`（`createTestArtifactStore`）が依存しており、単一実装でも 1 ファイル分の薄い抽象を保つコストは小さい。
- `S3StorageConfig` を `StorageConfig` にリネームし、`kind` 判別子は**除去**（union ではなくなるため）。参照側（`capture-coordinator.ts` の switch、`logSafeStorage` の分岐、テスト fixture の `kind: "s3"`）も全て同コミットで除去。
- `--s3-force-path-style` フラグは保持（既定 `true` で MinIO 互換、AWS 利用時は `--no-s3-force-path-style`）。
- 開発 compose は MinIO を本体ファイルにマージし、`compose.dev.s3.yaml` overlay は廃止。
- 本番 compose も自己完結 MinIO + minio-init を**同梱**し、dev/prod パリティを取る。root credentials は `${MINIO_ROOT_USER:-minioadmin}` / `${MINIO_ROOT_PASSWORD:-minioadmin}` 等で env 上書き可能にする。外部 S3（AWS / R2 等）に切り替えたい運用者は `BROWSERHIVE_S3_ENDPOINT` ほかを上書きし、`minio` / `minio-init` サービスは `docker compose up <service>` で除外する想定（compose ファイルの構造には影響を出さない）。

## Phase 1 — コアコード + テスト追従（1 コミット）

`local` 関連を撤去し S3 を必須化。テストも同コミットでグリーン化。

- [ ] `src/config/types.ts`: `LocalStorageConfig` 削除、`StorageConfig` を旧 `S3StorageConfig` の単一型に縮約（`kind` プロパティ削除、`bucket`/`endpoint`/`region`/`accessKeyId`/`secretAccessKey`/`keyPrefix?`/`forcePathStyle?` のみ）。`S3StorageConfig` は別名 export で互換維持はせず、参照側を直接書き換える
- [ ] `src/config/defaults.ts`: `DEFAULT_STORAGE_CONFIG` 削除、`DEFAULT_COORDINATOR_CONFIG` から `storage` フィールドを除去（`satisfies Omit<CoordinatorConfig, "storage">` 化）
- [ ] `src/config/index.ts`: barrel から `LocalStorageConfig`／`DEFAULT_STORAGE_CONFIG`／`S3StorageConfig` 旧名を削除、`StorageConfig` のみ export
- [ ] `src/cli/server-cli.ts`:
    - [ ] `--storage` フラグと `STORAGE_KINDS` / `isStorageKind` 一式を削除
    - [ ] `--output-dir` / `BROWSERHIVE_OUTPUT_DIR` を削除
    - [ ] `resolveStorageConfig` を「`--s3-*` 必須 4 項目（endpoint/bucket/accessKeyId/secretAccessKey）の不在で `program.error`」に簡素化（local/s3 排他チェック群は丸ごと削除）
    - [ ] `logSafeStorage` の `kind: "local"` 分岐を削除（フラットに S3 シェイプ出力）
    - [ ] `ParsedOptions` から `storage`/`outputDir` を削除、`ResolvedOptions` も同様に整理
- [ ] `src/storage/local-store.ts`: ファイル削除
- [ ] `src/storage/index.ts`: `LocalArtifactStore` の export を削除
- [ ] `src/capture/capture-coordinator.ts`: `buildArtifactStore` の `switch` を撤去し `new S3ArtifactStore(config.storage)` 直叩きに（関数自体を inline 化しても良い）
- [ ] `src/http/openapi.yaml`: `submitCapture.description` 内の "Captured files are written under the configured output directory." を S3 バケット表記に差し替え（生成物 `dist/openapi.dereferenced.json` は `prebuild` で再生成）
- [ ] `test/helpers/config.ts`:
    - [ ] `createTestCoordinatorConfig` のフォールバックを inline の最小 S3 `StorageConfig` に変更（`{ endpoint:"http://test", region:"us-east-1", bucket:"test-bucket", accessKeyId:"AKIA…", secretAccessKey:"…" }`）
    - [ ] `FakeArtifactStore` の docstring を「`writeFile` をモックする tests は `LocalArtifactStore` を使う」言及から「全テスト共通の in-memory store」に書き換え
- [ ] `test/capture/config.test.ts`: `DEFAULT_STORAGE_CONFIG` を検証する it ブロック削除（必要なら `DEFAULT_COORDINATOR_CONFIG` のフィールド集合検証に置換）
- [ ] `test/cli/server-cli.test.ts`:
    - [ ] `--storage=local` / `BROWSERHIVE_OUTPUT_DIR` を含むケースを全削除
    - [ ] `--storage=local で --s3-bucket` 排他、`--storage=s3 で --output-dir` 排他、`--storage` 不在/不正値ケースを削除
    - [ ] S3 必須 4 項目（endpoint/bucket/accessKeyId/secretAccessKey）の欠如時 exit ケースは保持・整理（旧 `--storage=s3` 前提を外す）
    - [ ] secret マスクログのケースを `--storage` 指定なしの形に書き換え
- [ ] `test/capture/page-capturer-{links,dismiss,pdf,timeout,redirect}.test.ts`: `new LocalArtifactStore("/tmp/...")` 系の生成箇所をすべて `createTestArtifactStore()`（`FakeArtifactStore`）に置換。`*Location` の string 値検証は join 結果に対する `toContain` 等に緩める（フェイクは `/tmp/bh-test-out` プレフィックスを返す）
- [ ] `test/storage/s3-store.test.ts`: 変更なしで通る想定（`baseConfig` から `kind: "s3"` を外すのみ）
- [ ] `npm run lint && npm test` グリーン
- [ ] コミット粒度: 1 コミット（`refactor!: drop local FS storage backend, S3 only`）

## Phase 2 — Docker / Compose（1 コミット）

`compose.dev.s3.yaml` overlay を廃止し、dev/prod とも MinIO 同梱で自己完結。

- [ ] `compose.dev.yaml`:
    - [ ] `compose.dev.s3.yaml` の `minio` / `minio-init` サービスを取り込み（image・healthcheck・networks・volumes をそのまま）
    - [ ] `browserhive.environment` を `BROWSERHIVE_S3_*` に書き換え（`STORAGE`/`OUTPUT_DIR` を削除、ENDPOINT=`http://minio:9000`、BUCKET=`browserhive`、KEY/SECRET=`minioadmin`、REGION=`us-east-1`）
    - [ ] `browserhive.depends_on` に `minio-init: service_completed_successfully` を追加
    - [ ] `volumes` 末尾に `minio-data` を追加
- [ ] `compose.dev.s3.yaml`: ファイル削除（`git rm`）
- [ ] `compose.prod.yaml`:
    - [ ] dev と対称に `minio` + `minio-init` サービスを**同梱**（root creds は `${MINIO_ROOT_USER:-minioadmin}` / `${MINIO_ROOT_PASSWORD:-minioadmin}`、image tag は dev と揃える）
    - [ ] `minio` の port は本番デフォルトで host に publish しない（`expose: ["9000", "9001"]`）。コンソールが必要な場合は override 想定
    - [ ] `browserhive.environment` から `BROWSERHIVE_STORAGE=local` / `BROWSERHIVE_OUTPUT_DIR=/app/output` を削除し `BROWSERHIVE_S3_*` に書き換え。`BROWSERHIVE_S3_ACCESS_KEY_ID` / `BROWSERHIVE_S3_SECRET_ACCESS_KEY` は MinIO 同梱のため `${MINIO_ROOT_USER:-minioadmin}` を再利用
    - [ ] `./output:/app/output` ボリュームマウント削除（永続化先は `minio-data` ボリュームに移動）
    - [ ] `browserhive.depends_on` に `minio-init: service_completed_successfully` を追加
    - [ ] 本番外部 S3（AWS / R2 / マネージド MinIO）切り替え用に `# Override BROWSERHIVE_S3_ENDPOINT to use external S3` のコメントを残す
- [ ] `Dockerfile.prod`: `RUN mkdir -p /app/output && chown -R node:node /app` から `mkdir` を除去（`/app` の chown は残す）。コメントの "Default mount point for captured files" を削除
- [ ] スモーク手順:
    1. `docker compose -f compose.dev.yaml down -v` で旧ボリューム破棄
    2. `GH_TOKEN=$(gh auth token) docker compose -f compose.dev.yaml up -d --build`
    3. コンテナ内で `npm ci && npm run build && npm run server` 起動 → `/v1/status` 200
    4. `node dist/examples/data-client.js --data data/smoke-test.yaml --jpeg --html --links --limit 3` 実行
    5. MinIO console (http://localhost:9001, minioadmin/minioadmin) で `browserhive` バケット内 `s3://browserhive/<filename>` を確認
    6. `docker compose -f compose.dev.yaml down -v` で後始末
    7. **prod 側スモーク**: `docker compose -f compose.prod.yaml up -d --build` → `curl http://localhost:8080/v1/status` 200 → `down -v`（最低限 boot 確認）
- [ ] コミット粒度: 1 コミット（`chore!: fold MinIO into compose.dev.yaml, remove local-FS volume`）

## Phase 3 — ドキュメント整備 + レビュー（1 コミット）

- [ ] `README.md`:
    - [ ] "Storage backends" 大セクションを「Storage」に縮約（S3 専用、`local` 説明・`local` example・「Either side requires...」段落を削除）
    - [ ] 環境変数表（"Environment variables"）から以下の行を削除: `--storage`, `--output-dir`, `BROWSERHIVE_STORAGE`, `BROWSERHIVE_OUTPUT_DIR`
    - [ ] `--s3-*` 行から「(required when --storage=s3)」括弧書きを除去（無条件必須）
    - [ ] Mermaid 図の `Files[(Screenshot / HTML)]` ノードを `Storage[(MinIO / S3)]` 等に変更し、Worker からの矢印先も更新
    - [ ] "Development Environment" 節の `compose.dev.yaml` 起動手順から overlay 言及を削除（旧 `-f compose.dev.s3.yaml` の章ごと削除 or 統合済みである旨に書き換え）
    - [ ] "Production Environment" の standalone `docker run` 例から `-v "$(pwd)/output:/app/output" -e BROWSERHIVE_OUTPUT_DIR=...` を削除し `-e BROWSERHIVE_S3_*` 群に置換
    - [ ] "TLS (Transport Layer Security)" 節の `--output-dir ./output/capture` 例も S3 env に置換
- [ ] `tasks/todo.md`: 本ドキュメントのレビュー欄を埋める（コミット hash・スモーク結果・テスト数）
- [ ] 再度 `npm run build && npm run lint && npm test` グリーン確認（OpenAPI 記述変更が prebuild で反映されること）
- [ ] コミット粒度: 1 コミット（`docs!: rewrite storage section for S3-only`）

## レビュー欄（フェーズ完了時に追記）

- Phase 1 commit: 未
- Phase 2 commit: 未
- Phase 3 commit: 未
- スモーク結果: 未
- テスト総数: 未
- 想定リスク:
  - `examples/data-client.ts` は HTTP のみで storage 非依存なので変更なし。
  - CI の `safe-chain` は `@aws-sdk/client-s3` 既存追加済みで依存増減なし。
  - Phase 2 で旧 `./output` ホストディレクトリは compose では未参照になるが、ファイル自体は残る → 運用者が手動破棄。
  - prod に MinIO を同梱するため、`minio-data` ボリュームのバックアップ運用は別途必要（このタスクのスコープ外、README に注意書きのみ追加）。
