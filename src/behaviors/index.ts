/**
 * Behavior subsystem (NODE side) barrel.
 *
 * The behavior runtime is injected into each captured page as a bundled script
 * (`runtime/`, built by scripts/build-behaviors.mjs). This module is the Node
 * entry point used by the capture pipeline.
 */
export { runBehaviors, resolveBehaviorRun } from "./inject.js";
export type {
  BehaviorConfig,
  BehaviorRequest,
  BehaviorRunReport,
  CustomBehavior,
} from "./types.js";
