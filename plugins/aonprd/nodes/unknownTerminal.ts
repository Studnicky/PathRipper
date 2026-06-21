// Node: aonprd:make-unknown
// Produces an UnknownOutput record for pages that did not match any type or
// had a malformed content span. Writes to state.output and routes to success.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import type { ScrapeState }   from '../../../src/state/ScrapeState.js';
import { makeUnknown }        from '../concepts/generic/index.js';

class UnknownTerminalNode extends ScalarNode<ScrapeState, 'success'> {
  public readonly name = 'aonprd:make-unknown';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<'success', SchemaObjectType> {
    return {
      // `success` — state.output set to an UnknownOutput record (url field)
      success: { type: 'object', properties: { output: { type: 'object' } }, required: ['output'] },
    };
  }

  // The node reads page.url from state directly (pre-seeded external state).

  protected override async executeOne(
    state:    ScrapeState,
    _context: NodeContextType,
  ): Promise<NodeOutputType<'success'>> {
    state.output = makeUnknown(state.page.url) as unknown as Record<string, unknown>;
    return NodeOutputBuilder.of('success');
  }
}

export const unknownTerminalNode = new UnknownTerminalNode();
