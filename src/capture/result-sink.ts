/**
 * Capture Result Sink
 *
 * 完了した capture の `CaptureResult` を受け取る先。`TaskQueue.markComplete`
 * が件数しか持たなくなった代わりに、結果そのものはここへ流れる。
 *
 * `record` は同期シグネチャにしてある。IO を伴う実装(`ManifestWriter`)も
 * 内部で fire-and-forget し、**capture の進行を絶対に止めない**。結果の
 * 記録に失敗しても capture 自体は成功しているため、ここで例外を投げて
 * ワーカーループを壊してはならない — 実装側が catch してログに落とす。
 *
 * @glossary CaptureResultSink
 * @category コンポーネント
 */
import type { CaptureResult } from "./types.js";

export interface CaptureResultSink {
  record(result: CaptureResult): void;
}

/**
 * 何もしない Sink。結果の公開を全部切った構成(キャッシュ 0 かつストア無し)で
 * `compositeSink([])` の代わりに使う。
 */
export const noopSink: CaptureResultSink = {
  record: () => undefined,
};

/**
 * 複数の Sink へ配る。呼び出し側(ワーカー)は Sink を 1 つしか知らなくてよい。
 *
 * 各 Sink が「投げない」ことは interface の契約なので、ここでは catch しない
 * — 握り潰すと契約違反が黙って隠れる。
 */
export const compositeSink = (sinks: CaptureResultSink[]): CaptureResultSink => ({
  record: (result) => {
    for (const sink of sinks) sink.record(result);
  },
});
