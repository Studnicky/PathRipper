// Node: aonprd:make-unknown
// Produces an UnknownOutput record for pages that did not match any type or
// had a malformed content span. Writes to state.output and routes to success.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import type { ScrapeState }   from '../../../src/state/ScrapeState.js';
import type { RipperServices }   from '../../../src/services/RipperServices.js';
import { makeUnknown }        from '../world.js';

export const unknownTerminalNode: NodeInterface<ScrapeState, 'success', RipperServices> = {
  name:    'aonprd:make-unknown',
  outputs: ['success'],

  async execute(
    state:    ScrapeState,
    _context: NodeContextInterface<RipperServices>,
  ): Promise<{ output: 'success' }> {
    state.output = makeUnknown(state.page.url) as unknown as Record<string, unknown>;
    return { output: 'success' };
  },
};

/** OperationContract for unknownTerminalContract: reads page.html metadata, produces output. */
export const unknownTerminalContract: OperationContract = {
  name:         'aonprd:make-unknown',
  hardRequired: ['page.html'],
  produces:     ['output'],
  outputs:      ['success'],
};
