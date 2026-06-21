import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import type { MemberResolutionState } from '../../state/MemberResolutionState.js';
import type { RipperServices }        from '../../services/RipperServices.js';

type ChooseModeOutput = 'resume-failures' | 'single-category' | 'by-categories' | 'all-pages';

/**
 * Selects the member-resolution mode from `state` flags and config.
 *
 * Priority order (highest to lowest):
 * 1. `state.resumeFailures === true` → `resume-failures`
 * 2. `state.category !== undefined`  → `single-category`
 * 3. `state.config.categories` is a non-empty array → `by-categories`
 * 4. Fallback → `all-pages`
 *
 * Output ports:
 * - `resume-failures`  — re-scrape titles from failures.json.
 * - `single-category`  — fetch members of the CLI-supplied category.
 * - `by-categories`    — fetch + deduplicate members of config-defined categories.
 * - `all-pages`        — enumerate every article in the main namespace.
 *
 * @category Nodes
 * @since 3.0.0
 */
class ChooseModeNodeImpl extends ScalarNode<MemberResolutionState, ChooseModeOutput, RipperServices> {
  public readonly name = 'wiki:choose-mode';
  public readonly outputs = ['resume-failures', 'single-category', 'by-categories', 'all-pages'] as const;

  public override get outputSchema(): Record<ChooseModeOutput, SchemaObjectType> {
    return {
      // `resume-failures` — routing decision only; no state delta.
      'resume-failures':  { type: 'object' },
      // `single-category` — routing decision only; no state delta.
      'single-category':  { type: 'object' },
      // `by-categories`   — routing decision only; no state delta.
      'by-categories':    { type: 'object' },
      // `all-pages`       — routing decision only; no state delta.
      'all-pages':        { type: 'object' },
    };
  }

  protected override async executeOne(
    state: MemberResolutionState,
    _context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<ChooseModeOutput>> {
    if (state.resumeFailures) {
      return NodeOutputBuilder.of('resume-failures');
    }
    if (state.category !== undefined) {
      return NodeOutputBuilder.of('single-category');
    }
    const configCategories = state.config['categories'];
    if (Array.isArray(configCategories) && configCategories.length > 0) {
      return NodeOutputBuilder.of('by-categories');
    }
    return NodeOutputBuilder.of('all-pages');
  }
}

export const ChooseModeNode = new ChooseModeNodeImpl();
