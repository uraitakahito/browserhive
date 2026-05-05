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

