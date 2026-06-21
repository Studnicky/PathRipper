/**
 * Unit tests for ReconcileIdentityNode and ReportCrawlHealthNode.
 */
import { describe, it, before, after } from 'node:test';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

import { Batch }               from '@studnicky/dagonizer';
import { NodeContextBuilder }  from '@studnicky/dagonizer/entities';

import { ScrapeState }              from '../../../src/state/ScrapeState.js';
import { ReconcileIdentityNode }    from '../../../src/nodes/ReconcileIdentityNode.js';
import { ReportCrawlHealthNode }    from '../../../src/nodes/ReportCrawlHealthNode.js';
import { RECONCILIATION_KEY }       from '../../../src/resilience/Reconciler.js';
import type { ReconcilerInterface } from '../../../src/resilience/Reconciler.js';
import type {
  CapturedFailureType,
  IdentityIndexType,
  ReconciliationSummaryType,
} from '../../../src/types/Reconciler.js';
import type { RipperServices }      from '../../../src/services/RipperServices.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const TARGET_ID      = 'test:crawl';
const PLUGIN_TASK    = 'test:page';
const BASE_OUT       = join('/tmp', `ripper-reconcile-test-${Date.now()}`);
const DOCS_DIR       = join(BASE_OUT, TARGET_ID, PLUGIN_TASK);

/** Build a minimal NodeContext with the given services overrides. */
const makeContext = (
  overrides: Partial<RipperServices> = {},
): ReturnType<typeof NodeContextBuilder.of<RipperServices>> =>
  NodeContextBuilder.of<RipperServices>(
    'test',
    'test',
    new AbortController().signal,
    {
      log: {
        debug: () => {},
        info:  () => {},
        warn:  () => {},
        error: () => {},
      } as unknown as RipperServices['log'],
      cache:          null,
      target:         { id: TARGET_ID },
      outDir:         BASE_OUT,
      pluginTaskName: PLUGIN_TASK,
      dispatcher:     {} as RipperServices['dispatcher'],
      ...overrides,
    } as unknown as RipperServices,
  );

/** Write a concept doc to the temp dir. */
const writeConceptDoc = (slug: string, doc: Record<string, unknown>): string => {
  const filePath = join(DOCS_DIR, `${slug}.json`);
  writeFileSync(filePath, JSON.stringify(doc), 'utf-8');
  return filePath;
};

/** Write an error doc to the temp dir. */
const writeErrorDoc = (slug: string, doc: Record<string, unknown>): string => {
  const filePath = join(DOCS_DIR, `${slug}.json`);
  writeFileSync(filePath, JSON.stringify({ _type: 'error', ...doc }), 'utf-8');
  return filePath;
};

// ── Stub reconciler ────────────────────────────────────────────────────────────

/**
 * Test reconciler: indexes on `output.name`; resolves a failure whose
 * `linkText` matches a known name to the URL where that name was captured.
 */
class StubReconciler implements ReconcilerInterface {
  public indexConcept(_url: string, output: Record<string, unknown>): readonly string[] {
    const name = output['name'];
    return typeof name === 'string' ? [name] : [];
  }

  public resolveFailure(
    failure: CapturedFailureType,
    index: IdentityIndexType,
  ): import('../../../src/types/Reconciler.js').ResolutionType {
    // Use the first error's message as "link text" for test matching.
    const linkText = failure.errors[0]?.message ?? '';
    const hits = index.get(linkText);
    if (hits !== undefined && hits.length > 0) {
      return { status: 'capturedElsewhere', at: hits[0] as string };
    }
    return { status: 'missing' };
  }
}

// ── Setup / teardown ───────────────────────────────────────────────────────────

before(() => {
  mkdirSync(DOCS_DIR, { recursive: true });
});

after(() => {
  rmSync(BASE_OUT, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ReconcileIdentityNode — stub reconciler', () => {
  it('routes done', async () => {
    // Two concept docs and one error doc that resolves capturedElsewhere.
    writeConceptDoc('catfolk', { url: 'https://example.com/Ancestries/3', name: 'Catfolk' });
    writeConceptDoc('goblin',  { url: 'https://example.com/Ancestries/4', name: 'Goblin' });
    writeErrorDoc('missing-catfolk', {
      url:    'https://example.com/Classes/3',
      errors: [{ code: 'fetchFailed', message: 'Catfolk', operation: 'html:fetch', context: {} }],
    });

    const state  = new ScrapeState();
    const result = await ReconcileIdentityNode.execute(
      Batch.of(state),
      makeContext({ reconciler: new StubReconciler() }),
    );
    assert.ok(result.has('done'));
  });

  it('error doc gains resolution: capturedElsewhere when name matches', async () => {
    const errorFile = join(DOCS_DIR, 'missing-catfolk.json');
    const onDisk = JSON.parse(readFileSync(errorFile, 'utf-8')) as Record<string, unknown>;

    assert.ok('resolution' in onDisk, 'resolution field should be written to error doc');
    const res = onDisk['resolution'] as { status: string; at?: string };
    assert.equal(res.status, 'capturedElsewhere');
    assert.equal(res.at, 'https://example.com/Ancestries/3');
  });

  it('summary metadata has correct totals', async () => {
    const state = new ScrapeState();
    // Re-run so the state has a fresh metadata snapshot.
    await ReconcileIdentityNode.execute(
      Batch.of(state),
      makeContext({ reconciler: new StubReconciler() }),
    );

    const summary = state.getMetadata<ReconciliationSummaryType>(RECONCILIATION_KEY);
    assert.ok(summary !== undefined, 'summary should be set in metadata');
    assert.equal(summary.totals.concepts,          2);
    assert.equal(summary.totals.failures,          1);
    assert.equal(summary.totals.capturedElsewhere, 1);
    assert.equal(summary.totals.missing,           0);
    assert.equal(summary.totals.dead,              0);
    assert.equal(summary.capturedElsewhere.length, 1);
    assert.equal(summary.capturedElsewhere[0]?.url, 'https://example.com/Classes/3');
    assert.equal(summary.capturedElsewhere[0]?.at,  'https://example.com/Ancestries/3');
  });
});

describe('ReconcileIdentityNode — default reconciler', () => {
  it('classifies all failures as missing with default reconciler', async () => {
    // Add a second error doc for this sub-suite.
    writeErrorDoc('missing-goblin', {
      url:    'https://example.com/Classes/4',
      errors: [{ code: 'fetchFailed', message: 'Goblin', operation: 'html:fetch', context: {} }],
    });

    const state = new ScrapeState();
    // No reconciler → uses DefaultReconciler → all missing.
    await ReconcileIdentityNode.execute(Batch.of(state), makeContext());

    const summary = state.getMetadata<ReconciliationSummaryType>(RECONCILIATION_KEY);
    assert.ok(summary !== undefined);
    assert.equal(summary.totals.capturedElsewhere, 0);
    assert.equal(summary.totals.missing,           summary.totals.failures);
    assert.equal(summary.totals.dead,              0);
  });
});

describe('ReconcileIdentityNode — empty directory', () => {
  it('handles missing docs directory gracefully', async () => {
    const state = new ScrapeState();
    const emptyCtx = makeContext({
      target:         { id: 'nonexistent:crawl' },
      pluginTaskName: 'nonexistent:page',
    });
    const result = await ReconcileIdentityNode.execute(Batch.of(state), emptyCtx);
    assert.ok(result.has('done'));

    const summary = state.getMetadata<ReconciliationSummaryType>(RECONCILIATION_KEY);
    assert.ok(summary !== undefined);
    assert.equal(summary.totals.concepts,  0);
    assert.equal(summary.totals.failures,  0);
  });
});

describe('ReportCrawlHealthNode', () => {
  it('writes crawl-health.json with correct structure', async () => {
    // Prime state with a known summary.
    const summary: ReconciliationSummaryType = {
      totals: { concepts: 5, failures: 2, capturedElsewhere: 1, missing: 1, dead: 0 },
      capturedElsewhere: [{ url: 'https://example.com/a', at: 'https://example.com/b' }],
      missing:  [{ url: 'https://example.com/c', errors: [{ code: 'err', message: 'msg' }] }],
      dead: [],
    };

    const state = new ScrapeState();
    state.setMetadata(RECONCILIATION_KEY, summary);

    const result = await ReportCrawlHealthNode.execute(Batch.of(state), makeContext());
    assert.ok(result.has('done'));

    const reportPath = join(BASE_OUT, TARGET_ID, 'crawl-health.json');
    const report = JSON.parse(readFileSync(reportPath, 'utf-8')) as Record<string, unknown>;

    assert.equal(report['target'], TARGET_ID);
    assert.ok(typeof report['generatedAt'] === 'string');
    const totals = report['totals'] as Record<string, number>;
    assert.equal(totals['concepts'],          5);
    assert.equal(totals['capturedElsewhere'], 1);
    assert.equal(totals['missing'],           1);
    assert.equal(totals['dead'],              0);
  });

  it('writes zero-totals report when no summary is present', async () => {
    const state = new ScrapeState();
    // No RECONCILIATION_KEY set → report:crawl-health falls back to zero totals.

    await ReportCrawlHealthNode.execute(Batch.of(state), makeContext());

    const reportPath = join(BASE_OUT, TARGET_ID, 'crawl-health.json');
    const report = JSON.parse(readFileSync(reportPath, 'utf-8')) as Record<string, unknown>;
    const totals = report['totals'] as Record<string, number>;
    assert.equal(totals['concepts'],  0);
    assert.equal(totals['failures'],  0);
    assert.equal(totals['missing'],   0);
  });
});
