/**
 * enrich-entity-link — post-scatter confirmation node for entity-link enrichment.
 *
 * For the `href-reconcile` engine: enrichment happened inline during the scatter
 * (in `ontologyProjection`, using the canonical index built by `index-entities`).
 * This node returns `'enriched'` to confirm completion and allow ontology-emit
 * to proceed. It is also the designated hook for a future `sortUnique` dedup pass.
 *
 * Returns `'skipped'` when no entityLink enrichment is configured.
 */

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import { isHrefReconcileConfig } from '../../config/EnrichmentConfig.js';
import { Logger }                from '../../modules/logger/logger.js';
import type { SquashageServices } from '../../services/SquashageServices.js';
import type { SquashageRunState } from '../../state/SquashageRunState.js';

const log = Logger.forComponent('EnrichEntityLinkNode');

type Output = 'enriched' | 'skipped';

class EnrichEntityLinkNodeImpl extends ScalarNode<SquashageRunState, Output, SquashageServices> {
  public readonly name    = 'enrich-entity-link';
  public readonly outputs = ['enriched', 'skipped'] as const;

  public override get outputSchema(): Record<Output, { type: 'object' }> {
    return {
      enriched: { type: 'object' },
      skipped:  { type: 'object' },
    };
  }

  protected override async executeOne(
    _state:  SquashageRunState,
    context: NodeContextType<SquashageServices>,
  ): Promise<NodeOutputType<Output>> {
    const enrichmentBlock = (context.services.targetConfig as unknown as Record<string, unknown>)['enrichment'];
    const rawConfig  = ((enrichmentBlock ?? {}) as Record<string, unknown>)['entityLink'];

    if (!isHrefReconcileConfig(rawConfig)) {
      return NodeOutputBuilder.of('skipped');
    }

    // href-reconcile: inline reconciliation already ran during the scatter.
    // Log summary and confirm.
    const indexSize  = context.services.entityIndex?.size ?? 0;
    const dedupCount = context.services.dedupSet?.size    ?? 0;
    log.info('executeOne', 'href-reconcile enrichment complete', {
      canonicalEntitiesIndexed: indexSize,
      dedupeMode:               rawConfig.dedupeTriples ?? 'inPass',
      uniqueQuadsWritten:       dedupCount,
    });

    return NodeOutputBuilder.of('enriched');
  }
}

export const enrichEntityLinkNode = new EnrichEntityLinkNodeImpl();
