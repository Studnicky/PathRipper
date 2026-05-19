import type { NodeInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import type { MemberResolutionState } from '../../state/MemberResolutionState.js';
import type { RipperServices }           from '../../services/RipperServices.js';

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
export const ChooseModeNode: NodeInterface<
  MemberResolutionState,
  'resume-failures' | 'single-category' | 'by-categories' | 'all-pages',
  RipperServices
> = {
  name: 'wiki:choose-mode',
  outputs: ['resume-failures', 'single-category', 'by-categories', 'all-pages'],

  async execute(
    state: MemberResolutionState,
  ): Promise<{ output: 'resume-failures' | 'single-category' | 'by-categories' | 'all-pages' }> {
    if (state.resumeFailures) {
      return { output: 'resume-failures' };
    }
    if (state.category !== undefined) {
      return { output: 'single-category' };
    }
    const configCategories = state.config['categories'];
    if (Array.isArray(configCategories) && configCategories.length > 0) {
      return { output: 'by-categories' };
    }
    return { output: 'all-pages' };
  },
};

/** OperationContract for ChooseModeNode: reads resumeFailures + category, routes only. */
export const chooseModeContract: OperationContract = {
  name:         'wiki:choose-mode',
  hardRequired: [],
  produces:     [],
  outputs:      ['resume-failures', 'single-category', 'by-categories', 'all-pages'],
};
