// Node: aonprd:make-unknown
// Produces an UnknownOutput record for pages that did not match any type or
// had a malformed content span. Writes to state.output and routes to success.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { OperationContractFragmentType } from '@studnicky/dagonizer/contracts';

import type { ScrapeState }   from '../../../src/state/ScrapeState.js';
import { makeUnknown }        from '../concepts/generic/index.js';

class UnknownTerminalNode extends ScalarNode<ScrapeState, 'success'> {
  public readonly name = 'aonprd:make-unknown';
  public readonly outputs = ['success'] as const;

  // Inline contract so DAGDeriver includes this node in topology derivation
  // when the taxonomy DAG is built with `nodes:`. The node reads page.url from
  // state directly (pre-seeded external state), so hardRequired is empty.
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: [] as const,
    produces:     [] as const,
  };

  protected override async executeOne(
    state:    ScrapeState,
    _context: NodeContextType,
  ): Promise<NodeOutputType<'success'>> {
    state.output = makeUnknown(state.page.url) as unknown as Record<string, unknown>;
    return NodeOutputBuilder.of('success');
  }
}

export const unknownTerminalNode = new UnknownTerminalNode();
