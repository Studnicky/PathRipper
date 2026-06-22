/**
 * index-entities — pre-scatter node that builds the canonical entity index
 * for href-reconcile enrichment.
 *
 * Runs once per run, BEFORE `process-all-records`. Scans every input file
 * using only the SubjectIriPolicy (no full RDF projection) to build a
 * `EntityIndex` mapping href-tails to canonical IRIs. The index is stored in
 * `services.entityIndex` so `ontologyProjection` can inline-resolve link-item
 * nodes during the scatter.
 *
 * When `dedupeTriples: "inPass"` is configured, also initialises
 * `services.dedupSet` so ontologyProjection can filter duplicate quads at
 * write time.
 *
 * No-op when `enrichment.entityLink.engine !== 'href-reconcile'` is absent or
 * uses a different engine.
 */

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import { EntityIndex } from '../../enrichment/EntityIndex.js';
import { isHrefReconcileConfig } from '../../config/EnrichmentConfig.js';
import type { SquashageServices } from '../../services/SquashageServices.js';
import type { SquashageRunState } from '../../state/SquashageRunState.js';
import { Logger } from '../../modules/logger/logger.js';

const log = Logger.forComponent('IndexEntitiesNode');

type Output = 'indexed' | 'skipped';

class IndexEntitiesNodeImpl extends ScalarNode<SquashageRunState, Output, SquashageServices> {
  public readonly name    = 'index-entities';
  public readonly outputs = ['indexed', 'skipped'] as const;

  public override get outputSchema(): Record<Output, { type: 'object' }> {
    return {
      indexed: { type: 'object' },
      skipped: { type: 'object' },
    };
  }

  protected override async executeOne(
    _state:  SquashageRunState,
    context: NodeContextType<SquashageServices>,
  ): Promise<NodeOutputType<Output>> {
    const { services } = context;
    const enrichmentBlock = (services.targetConfig as unknown as Record<string, unknown>)['enrichment'];
    const rawConfig  = ((enrichmentBlock ?? {}) as Record<string, unknown>)['entityLink'];

    if (!isHrefReconcileConfig(rawConfig)) {
      log.debug('executeOne', 'href-reconcile not configured — skipping entity index build');
      return NodeOutputBuilder.of('skipped');
    }

    const config      = rawConfig;
    const inputDir    = services.targetConfig.input.basePath;
    const inputFormat = services.targetConfig.input.format;

    log.info('executeOne', 'building canonical entity index', {
      inputDir,
      inputFormat,
      canonicalBase: config.canonicalBase,
    });

    const index = await EntityIndex.build(
      inputDir,
      inputFormat,
      services.subjectIri,
      config.canonicalBase,
    );

    services.entityIndex = index;

    log.info('executeOne', 'entity index built', { entries: index.size });

    // Initialise in-pass dedup set when configured.
    const dedupeMode = config.dedupeTriples ?? 'inPass';
    if (dedupeMode === 'inPass') {
      services.dedupSet = new Set<string>();
      log.debug('executeOne', 'in-pass dedup set initialised');
    }

    return NodeOutputBuilder.of('indexed');
  }
}

export const indexEntitiesNode = new IndexEntitiesNodeImpl();
