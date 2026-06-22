import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { HrefReconciler } from '../../../src/enrichment/HrefReconciler.js';
import { EntityIndex }    from '../../../src/enrichment/EntityIndex.js';
import { SubjectIriPolicy } from '../../../src/induction/SubjectIriPolicy.js';
import { dataFactory }    from '../../../src/rdf/DataFactory.js';
import type { TargetConfigInterface } from '../../../src/config/SquashageConfig.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const df  = dataFactory;
const BASE = 'https://squashage.dev/instance/aonprd/';
const LINKS_PRED   = 'https://2e.aonprd.com/links';
const HREF_PRED    = 'https://2e.aonprd.com/href';
const TEXT_PRED    = 'https://2e.aonprd.com/text';
const GRAPH        = df.namedNode('https://squashage.dev/graph/aonprd/Feat');

function makePolicy(): SubjectIriPolicy {
  const cfg = {
    input: { basePath: '.', format: 'json' },
    output: { kind: 'file', path: './out.nq' },
    subjectIri: { from: '/url', sanitize: 'url-tail', fallback: '/name' },
  } as unknown as TargetConfigInterface;
  return SubjectIriPolicy.fromTargetConfig(cfg, BASE);
}

async function buildIndex(records: Array<{ url: string }>): Promise<EntityIndex> {
  const dir = await mkdtemp(join(tmpdir(), 'reconciler-'));
  for (let i = 0; i < records.length; i++) {
    await writeFile(join(dir, `r${i}.json`), JSON.stringify(records[i]), 'utf8');
  }
  return EntityIndex.build(dir, 'json', makePolicy(), BASE);
}

// ── HrefReconciler.reconcile() ────────────────────────────────────────────────

describe('HrefReconciler.reconcile', () => {
  it('rewrites resolved link edge to canonical entity', async () => {
    const index = await buildIndex([
      { url: 'https://2e.aonprd.com/Ancestries.aspx?ID=65' },
    ]);

    const parent  = df.namedNode('https://squashage.dev/instance/aonprd/Feats.aspx?ID=312');
    const itemIri = df.namedNode('https://2e.aonprd.com/instances/Feat%23/properties/links/items-abc123');
    const canonical = df.namedNode(`${BASE}Ancestries.aspx?ID=65`);

    const quads = [
      df.quad(parent,  df.namedNode(LINKS_PRED), itemIri, GRAPH),
      df.quad(itemIri, df.namedNode(HREF_PRED),  df.literal('Ancestries.aspx?ID=65'), GRAPH),
      df.quad(itemIri, df.namedNode(TEXT_PRED),  df.literal('Leshy'), GRAPH),
    ];

    const result = HrefReconciler.reconcile(
      quads,
      new Set([LINKS_PRED]),
      HREF_PRED,
      index,
      df,
    );

    // Only the rewritten link edge should remain (item triples dropped)
    assert.equal(result.length, 1);
    assert.equal(result[0]!.subject.value,   parent.value);
    assert.equal(result[0]!.predicate.value, LINKS_PRED);
    assert.equal(result[0]!.object.value,    canonical.value);
  });

  it('keeps unresolvable link items unchanged', async () => {
    const index = await buildIndex([]); // empty — nothing resolves

    const parent  = df.namedNode('https://squashage.dev/instance/aonprd/Feats.aspx?ID=1');
    const itemIri = df.namedNode('https://2e.aonprd.com/instances/Feat%23/properties/links/items-deadbeef');

    const quads = [
      df.quad(parent,  df.namedNode(LINKS_PRED), itemIri, GRAPH),
      df.quad(itemIri, df.namedNode(HREF_PRED),  df.literal('Articles.aspx?ID=99'), GRAPH),
      df.quad(itemIri, df.namedNode(TEXT_PRED),  df.literal('Some Article'), GRAPH),
    ];

    const result = HrefReconciler.reconcile(
      quads,
      new Set([LINKS_PRED]),
      HREF_PRED,
      index,
      df,
    );

    // All three quads unchanged
    assert.equal(result.length, 3);
  });

  it('resolves multiple link items in one record quad set', async () => {
    const index = await buildIndex([
      { url: 'https://2e.aonprd.com/Ancestries.aspx?ID=14' },
      { url: 'https://2e.aonprd.com/Traits.aspx?ID=225' },
    ]);

    const parent = df.namedNode(`${BASE}Feats.aspx?ID=999`);
    const item1  = df.namedNode('https://2e.aonprd.com/instances/Feat%23/links/items-0001');
    const item2  = df.namedNode('https://2e.aonprd.com/instances/Feat%23/links/items-0002');

    const quads = [
      df.quad(parent, df.namedNode(LINKS_PRED), item1, GRAPH),
      df.quad(item1,  df.namedNode(HREF_PRED),  df.literal('Ancestries.aspx?ID=14'), GRAPH),
      df.quad(item1,  df.namedNode(TEXT_PRED),  df.literal('Leshy'), GRAPH),
      df.quad(parent, df.namedNode(LINKS_PRED), item2, GRAPH),
      df.quad(item2,  df.namedNode(HREF_PRED),  df.literal('Traits.aspx?ID=225'), GRAPH),
      df.quad(item2,  df.namedNode(TEXT_PRED),  df.literal('Leshy Trait'), GRAPH),
    ];

    const result = HrefReconciler.reconcile(quads, new Set([LINKS_PRED]), HREF_PRED, index, df);

    // 2 link edges → canonical, 4 item triples → dropped
    assert.equal(result.length, 2);
    const targets = result.map((q) => q.object.value).sort();
    assert.deepEqual(targets, [
      `${BASE}Ancestries.aspx?ID=14`,
      `${BASE}Traits.aspx?ID=225`,
    ].sort());
  });

  it('does not touch quads unrelated to link predicates', async () => {
    const index  = await buildIndex([{ url: 'https://2e.aonprd.com/Spells.aspx?ID=1' }]);
    const parent = df.namedNode(`${BASE}Feats.aspx?ID=1`);
    const nameQ  = df.quad(parent, df.namedNode('https://2e.aonprd.com/name'), df.literal('Fire Feat'), GRAPH);

    const result = HrefReconciler.reconcile([nameQ], new Set([LINKS_PRED]), HREF_PRED, index, df);

    assert.equal(result.length, 1);
    assert.equal(result[0]!.object.value, 'Fire Feat');
  });

  it('passes through quads when no link predicates match', async () => {
    const index = await buildIndex([]);
    const q     = df.quad(df.namedNode('s'), df.namedNode('p'), df.literal('o'), GRAPH);

    const result = HrefReconciler.reconcile([q], new Set([LINKS_PRED]), HREF_PRED, index, df);
    assert.equal(result.length, 1);
  });
});

// ── in-pass dedup helper (inline test of the dedup logic shared with ontologyProjection) ──

describe('in-pass dedup', () => {
  it('filters already-seen quads across calls', () => {
    const seen = new Set<string>();
    const q1 = df.quad(df.namedNode('s'), df.namedNode('p'), df.literal('o1'), df.defaultGraph());
    const q2 = df.quad(df.namedNode('s'), df.namedNode('p'), df.literal('o2'), df.defaultGraph());

    function dedupeQuads(quads: ReturnType<typeof df.quad>[], s: Set<string>): ReturnType<typeof df.quad>[] {
      const out: ReturnType<typeof df.quad>[] = [];
      for (const quad of quads) {
        const sig = `${quad.subject.value}\x1f${quad.predicate.value}\x1f${quad.object.value}\x1f${quad.graph.value}`;
        if (!s.has(sig)) { s.add(sig); out.push(quad); }
      }
      return out;
    }

    const first  = dedupeQuads([q1, q2, q1], seen);
    assert.equal(first.length, 2, 'duplicate within same call is filtered');

    const second = dedupeQuads([q1], seen);
    assert.equal(second.length, 0, 'quad seen in prior call is filtered');
  });
});
