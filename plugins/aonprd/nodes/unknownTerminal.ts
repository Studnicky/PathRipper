// Node: aonprd:make-unknown
// Produces an UnknownOutput record for pages that did not match any type or
// had a malformed content span. Writes to state.output and routes to success.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';

import type { ScrapeState }   from '../../../src/state/ScrapeState.js';
import type { RipperServices }   from '../../../src/services/RipperServices.js';
import { makeUnknown }        from '../concepts/generic/index.js';

export const unknownTerminalNode: NodeInterface<ScrapeState, 'success', RipperServices> = {
  name:    'aonprd:make-unknown',
  outputs: ['success'],

  // Inline contract so DAGDeriver includes this node in topology derivation
  // when the taxonomy DAG is built with `nodes:`. The node reads page.url from
  // state directly (pre-seeded external state), so hardRequired is empty.
  contract: {
    hardRequired: [] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state:    ScrapeState,
    _context: NodeContextInterface<RipperServices>,
  ): Promise<{ output: 'success' }> {
    state.output = makeUnknown(state.page.url) as unknown as Record<string, unknown>;
    return { output: 'success' };
  },
};
