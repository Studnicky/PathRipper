// Lane 12 e2e — two-pass cache snapshot:
//   PHASE 1: write-only cache + html:fetch + html:write-raw → raw HTML on disk + meta entries.
//   PHASE 2: read-only cache + html:fetch + aonprd:parse + json:write → must hit ZERO network.
//
// Run locally:                npm run test:e2e -- --test-name-pattern='snapshot'
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { DAGDocument } from '@studnicky/dagonizer';
import { runDag }      from '../../src/run/runDag.js';
import type { RunStateType } from '../../src/types/RunState.js';

export { parseAonHtml } from '../../plugins/aonprd/parse.task.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT           = resolve(__dirname, '..', '..');
const SCRAPE_DAG_PATH     = resolve(__dirname, 'fixtures/aonprd-scrape.dag.jsonld');
const SCRAPE_RAW_DAG_PATH = resolve(__dirname, 'fixtures/aonprd-scrape-raw.dag.jsonld');

const PROBES = [
  'https://2e.aonprd.com/Spells.aspx?ID=1',
  'https://2e.aonprd.com/Feats.aspx?ID=1',
  'https://2e.aonprd.com/Conditions.aspx?ID=1',
] as const;

describe('AONPRD snapshot e2e (local only)', () => {
  it('phase 1 writes raw + cache; phase 2 parses with zero network', async () => {
    const outDir   = await mkdtemp(resolve(tmpdir(), 'ripper-aonprd-snapshot-'));
    const cacheDir = resolve(outDir, '.cache', 'aonprd');

    try {
      // ── PHASE 1 ───────────────────────────────────────────────────────────
      // aonprd-raw DAG: html:fetch → html:write-raw only (no parse).
      // Entry DAG name = 'aonprd-raw' → target dir = <outDir>/aonprd-raw
      const entryDagRaw = DAGDocument.load(readFileSync(SCRAPE_RAW_DAG_PATH, 'utf-8'));
      const phase1State = {
        output:  { basePath: outDir },
        baseUrl: 'https://2e.aonprd.com',
        headers: { 'User-Agent': 'ripperoni-e2e/2.0 (+https://github.com/Studnicky/ripper)' },
        urls:    [...PROBES],
        cache:   { dir: cacheDir, mode: 'write-only' as const },
      } satisfies RunStateType;

      await runDag({ dag: entryDagRaw, state: phase1State, outDir, configDir: REPO_ROOT });

      // Raw HTML files land at <outDir>/aonprd-raw/raw/<slug>.html
      const rawDir   = resolve(outDir, 'aonprd-raw', 'raw');
      const rawFiles = await readdir(rawDir);
      assert.ok(rawFiles.length === PROBES.length,
        `phase 1: expected ${PROBES.length.toString()} raw HTML files, got ${rawFiles.length.toString()}`);
      for (const file of rawFiles) assert.match(file, /\.html$/);

      // No JSON output under the target dir in phase 1
      const targetDirRaw   = resolve(outDir, 'aonprd-raw');
      const phase1Files    = await readdir(targetDirRaw);
      assert.equal(phase1Files.filter((file): boolean => file.endsWith('.json')).length, 0,
        'phase 1: no JSON output expected');

      // ── PHASE 2 ───────────────────────────────────────────────────────────
      // aonprd DAG: html:fetch (cache read-only) → aonprd:parse → json:write.
      // Entry DAG name = 'aonprd'; splitByTaskName: false keeps JSON flat at
      // <outDir>/aonprd/<slug>.json.
      const fetchCalls: string[] = [];
      const origFetch = globalThis.fetch;
      globalThis.fetch = ((...args: Parameters<typeof origFetch>) => {
        fetchCalls.push(String(args[0]));
        return origFetch(...args);
      }) as typeof fetch;

      try {
        const entryDagParse = DAGDocument.load(readFileSync(SCRAPE_DAG_PATH, 'utf-8'));
        const phase2State = {
          output:  { basePath: outDir, splitByTaskName: false },
          baseUrl: 'https://2e.aonprd.com',
          headers: { 'User-Agent': 'ripperoni-e2e/2.0 (+https://github.com/Studnicky/ripper)' },
          urls:    [...PROBES],
          cache:   { dir: cacheDir, mode: 'read-only' as const },
        } satisfies RunStateType;

        await runDag({ dag: entryDagParse, state: phase2State, outDir, configDir: REPO_ROOT });
      } finally {
        globalThis.fetch = origFetch;
      }

      assert.equal(fetchCalls.length, 0,
        `phase 2 must not hit the network; saw: ${fetchCalls.join(', ')}`);

      // splitByTaskName: false keeps plugin JSON flat at <outDir>/aonprd/<slug>.json.
      const targetDir   = resolve(outDir, 'aonprd');
      const phase2Files = (await readdir(targetDir)).filter((file): boolean =>
        file.endsWith('.json') && file !== 'failures.json',
      );
      assert.ok(phase2Files.length === PROBES.length,
        `phase 2: expected ${PROBES.length.toString()} JSON files in aonprd/, got ${phase2Files.length.toString()}`);
      for (const file of phase2Files) {
        const json = JSON.parse(await readFile(resolve(targetDir, file), 'utf-8')) as {
          name?: string; source?: { book: string | null }; _raw?: unknown;
        };
        assert.ok(json.name  !== undefined && json.name  !== '', `${file}: missing name`);
        assert.ok(json.source !== undefined && json.source.book !== null, `${file}: missing source.book`);
        assert.equal(json._raw, undefined, `${file}: _raw must NOT be embedded in plugin JSON`);
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
