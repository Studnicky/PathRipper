import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import type { ConfigLoadState } from '../../state/ConfigLoadState.js';

/**
 * Post-normalize invariant assertions on the fully-resolved config.
 *
 * Invariants checked:
 * 1. No pipeline references the reserved task name `api:fetch`, which was
 *    removed in v3.0.0 and must not reappear.
 *
 * Output ports:
 * - `success`            — all invariants hold.
 * - `invariant-violated` — one or more invariants failed; details recorded on state.
 *
 * @category Nodes
 * @since 3.0.0
 */
export const AssertInvariantsNode: NodeInterface<ConfigLoadState, 'success' | 'invariant-violated'> = {
  name: 'config:assert-invariants',
  outputs: ['success', 'invariant-violated'],

  async execute(
    state: ConfigLoadState,
    _context: NodeContextInterface<undefined>,
  ): Promise<{ output: 'success' | 'invariant-violated' }> {
    if (state.normalized === null) {
      state.collectError({
        code:        'PRECONDITION_FAILED',
        message:     'config:assert-invariants requires state.normalized to be set',
        operation:   'config:assert-invariants',
        recoverable: false,
        timestamp:   new Date().toISOString(),
      });
      return { output: 'invariant-violated' };
    }

    const violations: string[] = [];

    // Invariant: `api:fetch` is a removed reserved task name.
    // Any pipeline that references it is misconfigured.
    const { targets, mediawiki } = state.normalized;

    if (targets !== undefined) {
      for (const [id, target] of Object.entries(targets)) {
        const pipeline = (target as Record<string, unknown>)['pipeline'];
        if (Array.isArray(pipeline) && (pipeline as string[]).includes('api:fetch')) {
          violations.push(`targets.${id}.pipeline references reserved task 'api:fetch' (removed in v3.0.0)`);
        }
      }
    }

    if (mediawiki !== undefined) {
      for (const [id, target] of Object.entries(mediawiki)) {
        const pipeline = (target as Record<string, unknown>)['pipeline'];
        if (Array.isArray(pipeline) && (pipeline as string[]).includes('api:fetch')) {
          violations.push(`mediawiki.${id}.pipeline references reserved task 'api:fetch' (removed in v3.0.0)`);
        }
      }
    }

    if (violations.length > 0) {
      state.collectError({
        code:        'INVARIANT_VIOLATED',
        message:     violations.join('; '),
        operation:   'config:assert-invariants',
        recoverable: false,
        timestamp:   new Date().toISOString(),
      });
      return { output: 'invariant-violated' };
    }

    return { output: 'success' };
  },
};

/** OperationContract for AssertInvariantsNode: reads normalized, produces nothing new. */
export const assertInvariantsContract: OperationContract = {
  name:         'config:assert-invariants',
  hardRequired: ['normalized'],
  produces:     [],
  outputs:      ['success', 'invariant-violated'],
};
