/**
 * Built-in behavior: autoplay (BROWSER side).
 *
 * Finds `<video>` / `<audio>` elements, muted-plays them so the browser starts
 * pulling media segments (which the NetworkRecorder then archives), and
 * directly fetches every media URL it can see (`currentSrc`, `src`, child
 * `<source>` elements, `poster`). Progressive `src`/`.mp4` media is captured
 * this way; adaptive HLS/DASH manifests are also fetched, though individual
 * segment coverage depends on how far playback progresses within the budget.
 *
 * Not in the default set — opt in with `--behaviors …,autoplay` or a request
 * `behaviors.builtins`, since pulling media can be large.
 */
import type { BehaviorCtx } from "../types";

const toAbsolute = (url: string): string | null => {
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return null;
  }
};

export class AutoPlayBehavior {
  static id = "autoplay";
  static isMatch(): boolean {
    return document.querySelector("video, audio") !== null;
  }

  async *run(ctx: BehaviorCtx): AsyncGenerator<{ msg: string; counter?: string }> {
    const media = Array.from(
      document.querySelectorAll<HTMLMediaElement>("video, audio"),
    );
    for (const el of media) {
      const urls = new Set<string>();
      const add = (u: string | null | undefined): void => {
        const abs = u ? toAbsolute(u) : null;
        if (abs) urls.add(abs);
      };
      add(el.currentSrc);
      add(el.getAttribute("src"));
      if (el instanceof HTMLVideoElement) add(el.getAttribute("poster"));
      for (const s of Array.from(el.querySelectorAll("source"))) {
        add(s.getAttribute("src"));
      }

      // Muted playback is allowed without a user gesture and makes the browser
      // fetch media segments; failures (no source, blocked) are ignored.
      try {
        el.muted = true;
        void el.play?.().catch(() => undefined);
      } catch {
        /* ignore */
      }

      for (const url of urls) {
        try {
          void fetch(url, { mode: "no-cors", credentials: "include" }).catch(
            () => undefined,
          );
        } catch {
          /* ignore */
        }
      }
      yield ctx.getState("played", "media");
    }

    // Give segment fetches a moment to start before the pass ends.
    await ctx.Lib.sleep(Number(ctx.opts.settleMs ?? 1000));
    yield ctx.getState("autoplay-done");
  }
}
