/**
 * ReportCrawlHealthNode — post-crawl health report writer.
 *
 * Runs once in the MAIN process after `reconcile:identity`. Reads the
 * {@link ReconciliationSummaryType} stashed under {@link RECONCILIATION_KEY}
 * and writes a human- and machine-readable `crawl-health.json` to
 * `<outDir>/<target.id>/crawl-health.json`.
 *
 * Output ports:
 * - `done` — report written to disk.
 *
 * @category Nodes
 * @since 3.2.0
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import type { ScrapeState }    from '../state/ScrapeState.js';
import type { RipperServices } from '../services/RipperServices.js';
import {
  RECONCILIATION_KEY,
} from '../resilience/Reconciler.js';
import type { ReconciliationSummaryType } from '../resilience/Reconciler.js';

// ── ReportCrawlHealthNode ──────────────────────────────────────────────────────

class ReportCrawlHealthNodeImpl extends ScalarNode<ScrapeState, 'done', RipperServices> {
  public readonly name = 'report:crawl-health';
  public readonly outputs = ['done'] as const;

  public override get outputSchema(): Record<'done', SchemaObjectType> {
    return {
      // `done` — crawl-health.json written to <outDir>/<target.id>/crawl-health.json.
      done: { type: 'object' },
    };
  }

  protected override async executeOne(
    state:   ScrapeState,
    context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<'done'>> {
    const { services } = context;

    const summary = state.getMetadata<ReconciliationSummaryType>(RECONCILIATION_KEY);

    // If no summary is present (reconcile:identity was skipped), produce a
    // minimal zero-totals report rather than failing.
    const resolved: ReconciliationSummaryType = summary ?? {
      totals: {
        concepts: 0, failures: 0, capturedElsewhere: 0, missing: 0, dead: 0,
      },
      capturedElsewhere: [],
      missing: [],
      dead: [],
    };

    const report = {
      generatedAt:       new Date().toISOString(),
      target:            services.target.id,
      totals:            resolved.totals,
      capturedElsewhere: resolved.capturedElsewhere,
      missing:           resolved.missing,
      dead:              resolved.dead,
    };

    const outPath = join(services.outDir, services.target.id, 'crawl-health.json');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');

    return NodeOutputBuilder.of('done');
  }
}

export const ReportCrawlHealthNode = new ReportCrawlHealthNodeImpl();
