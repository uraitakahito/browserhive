/**
 * Behavior runtime entry point (BROWSER side).
 *
 * esbuild bundles this into a single IIFE (`dist/src/behaviors/runtime.js`)
 * that browserhive injects into every captured page. It registers the
 * built-in behaviors and publishes the runner as `self.__bh_behaviors`.
 * Client-supplied custom behaviors are appended by the Node injector via
 * `self.__bh_behaviors.register(<class expression>)`.
 */
import { runner } from "./runner";
import { AutoScrollBehavior } from "./builtins/autoscroll";
import { AutoFetchBehavior } from "./builtins/autofetch";
import { AutoPlayBehavior } from "./builtins/autoplay";

runner.register(AutoScrollBehavior);
runner.register(AutoFetchBehavior);
runner.register(AutoPlayBehavior);

// Publish to the page. `globalThis` works in every browser execution context.
(globalThis as unknown as { __bh_behaviors: typeof runner }).__bh_behaviors =
  runner;
