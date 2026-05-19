import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import type { ScrapeState }  from '../state/ScrapeState.js';
import type { RipperServices }  from '../services/RipperServices.js';

/**
 * No-op terminator node.
 *
 * Deep-DAG placements cannot route any output to `null` — the engine treats
 * `null` routes from a sub-dag as a misuse ("deep-DAGs are reusable components
 * and may not terminate the run"). The outer composition DAG therefore routes
 * its final sub-dag's outputs into this trivial terminator, which has a single
 * `success` output that routes to `null` (legal for a `SingleNode` placement).
 *
 * @category Nodes
 * @since 3.0.0
 */
export const TerminalNode: NodeInterface<ScrapeState, 'success', RipperServices> = {
  name:    'flow:terminate',
  outputs: ['success'],

  async execute(
    _state:   ScrapeState,
    _context: NodeContextInterface<RipperServices>,
  ): Promise<{ output: 'success' }> {
    return { output: 'success' };
  },
};

/** OperationContract for TerminalNode: no inputs required, no state produced. */
export const terminalContract: OperationContract = {
  name:         'flow:terminate',
  hardRequired: [],
  produces:     [],
  outputs:      ['success'],
};
