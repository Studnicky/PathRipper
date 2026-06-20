import { ScalarNode, NodeOutputBuilder, NodeErrorBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { OperationContractType } from '@studnicky/dagonizer/contracts';

import type { ConfigLoadState } from '../../state/ConfigLoadState.js';

type AssertInvariantsOutput = 'success' | 'invariant-violated';

/** OperationContractType for AssertInvariantsNode: reads normalized, produces nothing new. */
export const assertInvariantsContract: OperationContractType = {
  name:         'config:assert-invariants',
  hardRequired: ['normalized'],
  produces:     [],
  outputs:      ['success', 'invariant-violated'],
};

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
class AssertInvariantsNodeImpl extends ScalarNode<ConfigLoadState, AssertInvariantsOutput, undefined> {
  public readonly name = 'config:assert-invariants';
  public readonly outputs = ['success', 'invariant-violated'] as const;
  public override readonly contract = assertInvariantsContract;

  protected override async executeOne(
    state: ConfigLoadState,
    _context: NodeContextType<undefined>,
  ): Promise<NodeOutputType<AssertInvariantsOutput>> {
    if (state.normalized === null) {
      state.collectError(NodeErrorBuilder.from(
        'PRECONDITION_FAILED',
        'config:assert-invariants requires state.normalized to be set',
        'config:assert-invariants',
        false,
        new Date().toISOString(),
      ));
      return NodeOutputBuilder.of('invariant-violated');
    }

    const violations: string[] = [];

    // Invariant: `api:fetch` is a removed reserved task name.
    // Any pipeline that references it is misconfigured.
    const { targets, mediawiki } = state.normalized;

    if (targets !== undefined) {
      for (const [targetId, target] of Object.entries(targets)) {
        const pipeline = (target as Record<string, unknown>)['pipeline'];
        if (Array.isArray(pipeline) && (pipeline as string[]).includes('api:fetch')) {
          violations.push(`targets.${targetId}.pipeline references reserved task 'api:fetch' (removed in v3.0.0)`);
        }
      }
    }

    if (mediawiki !== undefined) {
      for (const [targetId, target] of Object.entries(mediawiki)) {
        const pipeline = (target as Record<string, unknown>)['pipeline'];
        if (Array.isArray(pipeline) && (pipeline as string[]).includes('api:fetch')) {
          violations.push(`mediawiki.${targetId}.pipeline references reserved task 'api:fetch' (removed in v3.0.0)`);
        }
      }
    }

    if (violations.length > 0) {
      state.collectError(NodeErrorBuilder.from(
        'INVARIANT_VIOLATED',
        violations.join('; '),
        'config:assert-invariants',
        false,
        new Date().toISOString(),
      ));
      return NodeOutputBuilder.of('invariant-violated');
    }

    return NodeOutputBuilder.of('success');
  }
}

export const AssertInvariantsNode = new AssertInvariantsNodeImpl();
