/**
 * In-Memory Result Store
 *
 * 直近 N 件の `CaptureResult` だけを保持する `CaptureResultSink`。
 * `GET /v1/captures/{taskId}` の裏付けであり、**原本ではない**
 * — 耐久性のある記録は `ManifestWriter` が artifact store に書く
 * `.result.json` のほう。だからここから溢れても情報は失われず、
 * 溢れた taskId は 404 を返す(そのときクライアントはマニフェストを見る)。
 *
 * `Map` は挿入順を保つので、上限を超えたら最古の key を 1 つ落とすだけで
 * FIFO のリングバッファになる。同じ taskId を再度 record したときは
 * `set` が既存の位置を保ったまま値を差し替える点に注意 — 実運用では
 * 1 タスク 1 回しか呼ばれないため問題にならない。
 *
 * @glossary InMemoryResultStore
 * @category コンポーネント
 */
import type { CaptureResultSink } from "./result-sink.js";
import type { CaptureResult } from "./types.js";

export class InMemoryResultStore implements CaptureResultSink {
  private readonly results = new Map<string, CaptureResult>();
  private readonly capacity: number;

  /**
   * @param capacity 保持する最大件数。1 未満は「保持しない」として扱う
   *   (`record` が即座に捨てる)。
   */
  constructor(capacity: number) {
    this.capacity = capacity;
  }

  record(result: CaptureResult): void {
    if (this.capacity < 1) return;
    this.results.set(result.task.taskId, result);
    if (this.results.size > this.capacity) {
      const oldest = this.results.keys().next();
      if (!oldest.done) this.results.delete(oldest.value);
    }
  }

  get(taskId: string): CaptureResult | undefined {
    return this.results.get(taskId);
  }

  /** 保持件数。上限の効きをテストと運用診断で確かめるために公開する。 */
  get size(): number {
    return this.results.size;
  }
}
