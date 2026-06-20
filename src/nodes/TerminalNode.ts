import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import type { ScrapeState }   from '../state/ScrapeState.js';
import type { RipperServices } from '../services/RipperServices.js';

type TerminalOutput = 'success';

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
class TerminalNodeImpl extends ScalarNode<ScrapeState, TerminalOutput, RipperServices> {
  public readonly name = 'flow:terminate';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    _state:   ScrapeState,
    _context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<TerminalOutput>> {
    return NodeOutputBuilder.of('success');
  }
}

export const TerminalNode = new TerminalNodeImpl();
