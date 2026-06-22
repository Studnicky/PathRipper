import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EntityIndex } from '../../../src/enrichment/EntityIndex.js';
import { SubjectIriPolicy } from '../../../src/induction/SubjectIriPolicy.js';
import type { TargetConfigInterface } from '../../../src/config/SquashageConfig.js';

const BASE = 'https://squashage.dev/instance/aonprd/';

function policy(): SubjectIriPolicy {
  const cfg: TargetConfigInterface = {
    input:  { basePath: '.', format: 'json' },
    output: { kind: 'file', path: './out.nq' },
    subjectIri: { from: '/url', sanitize: 'url-tail', fallback: '/name' },
  } as unknown as TargetConfigInterface;
  return SubjectIriPolicy.fromTargetConfig(cfg, BASE);
}

// ── EntityIndex.build() ───────────────────────────────────────────────────────

describe('EntityIndex.build', () => {
  it('indexes canonical entities from json files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'entity-index-'));
    const records = [
      { url: 'https://2e.aonprd.com/Ancestries.aspx?ID=14', name: 'Leshy' },
      { url: 'https://2e.aonprd.com/Spells.aspx?ID=100',    name: 'Fireball' },
    ];
    for (const r of records) {
      await writeFile(join(dir, `${r.name}.json`), JSON.stringify(r), 'utf8');
    }

    const index = await EntityIndex.build(dir, 'json', policy(), BASE);

    assert.equal(index.size, 2);
    assert.equal(index.resolve('Ancestries.aspx?ID=14'), `${BASE}Ancestries.aspx?ID=14`);
    assert.equal(index.resolve('Spells.aspx?ID=100'),    `${BASE}Spells.aspx?ID=100`);
  });

  it('resolve strips leading slash from href', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'entity-index-'));
    await writeFile(join(dir, 'feat.json'), JSON.stringify({ url: 'https://2e.aonprd.com/Feats.aspx?ID=7' }), 'utf8');

    const index = await EntityIndex.build(dir, 'json', policy(), BASE);

    // href may arrive with or without leading /
    assert.equal(index.resolve('/Feats.aspx?ID=7'), `${BASE}Feats.aspx?ID=7`);
    assert.equal(index.resolve('Feats.aspx?ID=7'),  `${BASE}Feats.aspx?ID=7`);
  });

  it('returns undefined for unindexed href', async () => {
    const dir   = await mkdtemp(join(tmpdir(), 'entity-index-'));
    const index = await EntityIndex.build(dir, 'json', policy(), BASE);
    assert.equal(index.resolve('Articles.aspx?ID=99'), undefined);
  });

  it('does not index records that fall back to a hash IRI', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'entity-index-'));
    // Record with no url and no fallback name → hash IRI (not under canonicalBase pattern)
    await writeFile(join(dir, 'nourl.json'), JSON.stringify({ data: 'nope' }), 'utf8');

    const index = await EntityIndex.build(dir, 'json', policy(), BASE);
    assert.equal(index.size, 0);
  });

  it('pre-scan IRI equals projected SubjectIriPolicy IRI for same record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'entity-index-'));
    const record = { url: 'https://2e.aonprd.com/Traits.aspx?ID=225', name: 'Leshy' };
    const filePath = join(dir, 'trait.json');
    await writeFile(filePath, JSON.stringify(record), 'utf8');

    const p     = policy();
    const index = await EntityIndex.build(dir, 'json', p, BASE);

    const viaIndex     = index.resolve('Traits.aspx?ID=225');
    const viaProjection = p.resolve(record, filePath, 0);

    assert.equal(viaIndex, viaProjection, 'pre-scan IRI must equal projection IRI');
  });

  it('walks subdirectories', async () => {
    const dir    = await mkdtemp(join(tmpdir(), 'entity-index-'));
    const subdir = join(dir, 'sub');
    await mkdir(subdir, { recursive: true });
    await writeFile(join(subdir, 'r.json'), JSON.stringify({ url: 'https://2e.aonprd.com/Feats.aspx?ID=1' }), 'utf8');

    const index = await EntityIndex.build(dir, 'json', policy(), BASE);
    assert.equal(index.size, 1);
    assert.equal(index.resolve('Feats.aspx?ID=1'), `${BASE}Feats.aspx?ID=1`);
  });
});
