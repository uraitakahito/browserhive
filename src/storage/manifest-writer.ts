/**
 * Result Manifest Writer
 *
 * 完了した capture の結果を `{taskId}_{correlationId}_{labels}.result.json`
 * として成果物と同じバケットへ書く `CaptureResultSink`。
 *
 * ## なぜ artifact store に書くのか
 *
 * `InMemoryResultStore` は上限つきで、プロセスが再起動すれば消える。台帳を
 * 外部に持つ利用者(waggle)にとっては「取りこぼした結果は永久に分からない」
 * ことになり、しかも取りこぼしたこと自体に気づけない。マニフェストは成果物
 * と同じ耐久性を持つので、消費側が数時間止まっていても後から追いつける。
 *
 * ## 成功だけでなく失敗も書く
 *
 * 失敗時こそ書く価値がある。書かなければ消費側から見て「まだ処理中」と
 * 「失敗して二度と来ない」が区別できず、いつまでも待つことになる。
 *
 * ## 書き込み失敗は capture の失敗ではない
 *
 * `record` は投げない(`CaptureResultSink` の契約)。マニフェストが書けなくても
 * 成果物はすでに上がっており、capture は成功している。エラーはログに落として
 * 握る — ここで例外を投げるとワーカーループが壊れる。
 *
 * @glossary ManifestWriter
 * @category コンポーネント
 */
import type { CaptureResult } from "../capture/types.js";
import type { CaptureResultSink } from "../capture/result-sink.js";
import { generateFilename } from "../capture/page-capturer.js";
import { captureResultToReport } from "../http/response-mapper.js";
import type { Logger } from "../logger.js";
import type { ArtifactStore } from "./types.js";

/** 成果物と同じ命名規則に乗せるための拡張子。`links.json` と同じ使い方。 */
const MANIFEST_EXTENSION = "result.json";

export class ManifestWriter implements CaptureResultSink {
  private readonly store: ArtifactStore;
  private readonly logger: Logger;

  constructor(store: ArtifactStore, logger: Logger) {
    this.store = store;
    this.logger = logger;
  }

  record(result: CaptureResult): void {
    // fire-and-forget: capture の進行を待たせない。
    void this.write(result).catch((cause: unknown) => {
      this.logger.error(
        {
          taskId: result.task.taskId,
          ...(result.task.correlationId !== undefined && {
            correlationId: result.task.correlationId,
          }),
          err: cause,
        },
        "Failed to write result manifest",
      );
    });
  }

  private async write(result: CaptureResult): Promise<void> {
    const filename = generateFilename(result.task, MANIFEST_EXTENSION);
    // Same body as `GET /v1/captures/{taskId}` — one shape, two delivery
    // mechanisms, so a consumer parses either with the same code.
    const body = JSON.stringify(captureResultToReport(result), null, 2);
    const location = await this.store.put(filename, body, "application/json");
    this.logger.debug({ taskId: result.task.taskId, location }, "Wrote result manifest");
  }
}
