/**
 * Link-resolution config type.
 *
 * Placed in `services.resolve` to enable the `resolve:link` node.
 * When absent, `resolve:link` routes immediately to `unresolved`.
 *
 * @module types/LinkResolve
 * @since 3.2.0
 */

/**
 * Configuration for the opt-in `resolve:link` node.
 *
 * @category Resilience
 * @since 3.2.0
 */
export type ResolveConfigType = {
  /** Ordered strategy names to attempt (e.g. `['crossLocator', 'canonical']`). */
  readonly strategies: readonly string[];
  /**
   * Category names for the `crossLocator` strategy.
   * Each non-failed category is tried with the same numeric ID from the failed url.
   */
  readonly categorySet?: readonly string[] | undefined;
  /**
   * URL template for the `search` strategy; `{q}` is replaced with the
   * URL-encoded link text from the failure context.
   */
  readonly searchUrl?: string | undefined;
  /**
   * Maximum resolve attempts per page before the node gives up (`unresolved`).
   * Defaults to `2` when absent.
   */
  readonly budget?: number | undefined;
};
