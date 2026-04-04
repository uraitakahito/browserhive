/**
 * Generic State Machine
 *
 * Reusable state machine with declarative transition rules.
 * Used by WorkerStatusManager and CoordinatorLifecycleManager.
 */

/** Base state definition requiring only allowed transitions */
export interface BaseStateDefinition<S extends string> {
  readonly allowedTransitions: readonly S[];
}

/** Map of state names to their definitions */
export type StateDefinitions<S extends string, D extends BaseStateDefinition<S>> = Record<S, D>;

export class StateMachine<S extends string> {
  private _status: S;
  private definitions: StateDefinitions<S, BaseStateDefinition<S>>;

  constructor(
    definitions: StateDefinitions<S, BaseStateDefinition<S>>,
    initial: S
  ) {
    this.definitions = definitions;
    this._status = initial;
  }

  get current(): S {
    return this._status;
  }

  canTransitionTo(next: S): boolean {
    return this.definitions[this._status].allowedTransitions.includes(next);
  }

  /**
   * Transition to a new state (with validation)
   * @throws Error if the transition is invalid
   */
  transitionTo(next: S): void {
    if (!this.canTransitionTo(next)) {
      throw new Error(
        `Invalid status transition: ${this._status} -> ${next}`
      );
    }
    this._status = next;
  }
}
