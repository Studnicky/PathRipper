/**
 * ReconcileIdentityNode — post-crawl identity reconciliation.
 *
 * Runs once in the MAIN process after the scatter completes, reading every
 * per-page JSON doc the scatter wrote. Partitions docs into concepts and
 * failures, builds an identity index via the plugin's reconciler (or the
 * default no-op), resolves each failure, writes the resolution back into the
 * error doc on disk, and stashes a {@link ReconciliationSummaryType} in state
 * metadata under {@link RECONCILIATION_KEY} for the downstream
 * `report:crawl-health` node.
 *
 * Output ports:
 * - `done` — reconciliation complete; summary available in metadata.
 *
 * @category Nodes
 * @since 3.2.0
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import type { ScrapeState }    from '../state/ScrapeState.js';
import type { RipperServices } from '../services/RipperServices.js';
import {
  RECONCILIATION_KEY,
  defaultReconciler,
} from '../resilience/Reconciler.js';
import type {
  CapturedFailureType,
  ReconciliationSummaryType,
} from '../resilience/Reconciler.js';

// ── ReconcileIdentityNode ──────────────────────────────────────────────────────

class ReconcileIdentityNodeImpl extends ScalarNode<ScrapeState, 'done', RipperServices> {
  public readonly name = 'reconcile:identity';
  public readonly outputs = ['done'] as const;

  public override get outputSchema(): Record<'done', SchemaObjectType> {
    return {
      // `done` — reconciliation summary stashed in state metadata under RECONCILIATION_KEY.
      done: { type: 'object' },
    };
  }

  protected override async executeOne(
    state:   ScrapeState,
    context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<'done'>> {
    const { services } = context;
    const dir = join(services.outDir, services.target.id, services.pluginTaskName ?? '');

    // ── Read all per-page docs ───────────────────────────────────────────────
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((file) => file.endsWith('.json'));
    } catch {
      // Directory absent (empty crawl) — treat as zero docs.
    }

    const concepts: Array<{ url: string; doc: Record<string, unknown>; file: string }> = [];
    const failures: Array<{ failure: CapturedFailureType; file: string }> = [];

    for (const file of files) {
      const filePath = join(dir, file);
      let doc: Record<string, unknown>;
      try {
        doc = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (doc['_type'] === 'error') {
        const url    = typeof doc['url'] === 'string' ? doc['url'] : filePath;
        const errors = Array.isArray(doc['errors'])
          ? (doc['errors'] as Array<{ code: string; message: string; operation: string }>)
              .map((err) => ({ code: err.code ?? '', message: err.message ?? '', operation: err.operation ?? '' }))
          : [];
        failures.push({ failure: { url, errors }, file: filePath });
      } else {
        const url = typeof doc['url'] === 'string' ? doc['url'] : filePath;
        concepts.push({ url, doc, file: filePath });
      }
    }

    // ── Build identity index ─────────────────────────────────────────────────
    const reconciler = services.reconciler ?? defaultReconciler;
    const indexMut = new Map<string, string[]>();

    for (const { url, doc } of concepts) {
      const keys = reconciler.indexConcept(url, doc);
      for (const key of keys) {
        const existing = indexMut.get(key);
        if (existing !== undefined) {
          existing.push(url);
        } else {
          indexMut.set(key, [url]);
        }
      }
    }

    const index: ReadonlyMap<string, readonly string[]> = indexMut;

    // ── Resolve each failure ─────────────────────────────────────────────────
    let countCapturedElsewhere = 0;
    let countMissing           = 0;
    let countDead              = 0;

    const capturedElsewhereList: Array<{ url: string; at: string }>  = [];
    const missingList:           Array<{ url: string; errors: readonly { code: string; message: string }[] }> = [];
    const deadList:              Array<{ url: string; reason: string }> = [];

    for (const { failure, file } of failures) {
      const resolution = reconciler.resolveFailure(failure, index);

      // Write resolution back into the error doc on disk.
      let existingDoc: Record<string, unknown> = {};
      try {
        existingDoc = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
      } catch {
        // Fall back to empty doc if re-read fails.
      }
      const updated = { ...existingDoc, resolution };
      writeFileSync(file, JSON.stringify(updated, null, 2), 'utf-8');

      // Tally.
      if (resolution.status === 'capturedElsewhere') {
        countCapturedElsewhere++;
        capturedElsewhereList.push({ url: failure.url, at: resolution.at });
      } else if (resolution.status === 'missing') {
        countMissing++;
        missingList.push({ url: failure.url, errors: failure.errors });
      } else {
        countDead++;
        deadList.push({ url: failure.url, reason: resolution.reason });
      }
    }

    // ── Build and stash summary ──────────────────────────────────────────────
    const summary: ReconciliationSummaryType = {
      totals: {
        concepts:           concepts.length,
        failures:           failures.length,
        capturedElsewhere:  countCapturedElsewhere,
        missing:            countMissing,
        dead:               countDead,
      },
      capturedElsewhere: capturedElsewhereList,
      missing:           missingList,
      dead:              deadList,
    };

    state.setMetadata(RECONCILIATION_KEY, summary);

    services.log.info(
      'reconcile:identity',
      `${failures.length} failures: `
      + `${countCapturedElsewhere} captured-elsewhere, `
      + `${countMissing} missing, `
      + `${countDead} dead`,
    );

    return NodeOutputBuilder.of('done');
  }
}

export const ReconcileIdentityNode = new ReconcileIdentityNodeImpl();
