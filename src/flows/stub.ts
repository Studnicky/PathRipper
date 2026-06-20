/**
 * stub — registration-time NodeInterface placeholder for docs-build and
 * dispatcher validation.
 *
 * Used in `registerAllFlows.ts` where virtual operation names used in
 * DAGBuilder-built phase flows (fan-out sentinels, CLI nodes, config nodes,
 * crawl nodes) must be registered on the dispatcher for structural validation
 * at docs-build time. The real nodes are registered on the dispatcher before
 * actual dispatch.
 *
 * Also used in `runHtml.ts` for the crawl phase DAG's `crawl:list-targets`
 * single-node slot for docs-build registration (the real `CrawlListTargetsNode` is
 * registered separately on the dispatcher before dispatch).
 *
 * The `executeOne` function throws immediately — any call indicates a registration
 * bug (the dispatcher resolved the stub instead of the registered node).
 *
 * @module flows/stub
 * @since 4.0.0
 */

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeInterface, NodeOutputType } from '@studnicky/dagonizer';

import type { ScrapeState }    from '../state/ScrapeState.js';
import type { RipperServices } from '../services/RipperServices.js';

/**
 * Creates a registration-only stub `NodeInterface`.
 *
 * @param name    - The node name (must match what the dispatcher registers).
 * @param outputs - The full set of output ports the node may return.
 * @returns A stub node that throws when `executeOne` is called.
 *
 * @category Flows
 * @since 4.0.0
 */
export function stub<TOutput extends string>(
  name:    string,
  outputs: readonly TOutput[],
): NodeInterface<ScrapeState, TOutput, RipperServices> {
  class StubNode extends ScalarNode<ScrapeState, TOutput, RipperServices> {
    public readonly name = name;
    public readonly outputs = outputs;

    protected override async executeOne(
      _state:   ScrapeState,
      _context: NodeContextType<RipperServices>,
    ): Promise<NodeOutputType<TOutput>> {
      throw new Error(
        `stub for '${name}' called — the real node must be registered on the dispatcher`,
      );

      // Unreachable — satisfies the return type for the compiler.
      return NodeOutputBuilder.of(outputs[0] as TOutput);
    }
  }

  return new StubNode();
}
