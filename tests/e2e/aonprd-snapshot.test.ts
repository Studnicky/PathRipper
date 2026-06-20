// Lane 12 e2e — two-pass cache snapshot:
//   PHASE 1: write-only cache + html:fetch + html:write-raw → raw HTML on disk + meta entries.
//   PHASE 2: read-only cache + html:fetch + aonprd:parse + json:write → must hit ZERO network.
//
// Run locally:                npm run test:e2e -- --test-name-pattern='snapshot'
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { runHtml }     from '../../src/run/runHtml.js';
import { RipperConfig } from '../../src/config/RipperConfig.js';
export { parseAonHtml } from '../../plugins/aonprd/parse.task.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE   = resolve(__dirname, 'fixtures/aonprd-crawler.config.json');

const PROBES: ReadonlyArray<string> = [
  'https://2e.aonprd.com/Spells.aspx?ID=1',
  'https://2e.aonprd.com/Feats.aspx?ID=1',
  'https://2e.aonprd.com/Conditions.aspx?ID=1',
];

describe('AONPRD snapshot e2e (local only)', () => {
  it('phase 1 writes raw + cache; phase 2 parses with zero network', async () => {
    const baseFx    = await RipperConfig.load(FIXTURE);
    const aonTarget = baseFx.targets!['aonprd']!;
    const outDir    = await mkdtemp(resolve(tmpdir(), 'ripper-aonprd-snapshot-'));
    const cacheDir  = resolve(outDir, '.cache', 'aonprd');

    try {
      // ── PHASE 1 ───────────────────────────────────────────────────────────
      const phase1Config = {
        ...baseFx,
        targets: {
          aonprd: {
            ...aonTarget,
            pipeline: ['html:fetch', 'html:write-raw'],
            cache:    { dir: cacheDir, mode: 'write-only' as const },
          },
        },
      };

      await runHtml({
        target:    'aonprd',
        paths:     [...PROBES],
        outDir,
        configDir: resolve(__dirname, '..', '..'),
        config:    phase1Config,
      });

      const rawDir   = resolve(outDir, 'aonprd', 'raw');
      const rawFiles = await readdir(rawDir);
      assert.ok(rawFiles.length === PROBES.length,
        `phase 1: expected ${PROBES.length.toString()} raw HTML files, got ${rawFiles.length.toString()}`);
      for (const file of rawFiles) assert.match(file, /\.html$/);

      const targetDir   = resolve(outDir, 'aonprd');
      const phase1Files = await readdir(targetDir);
      assert.equal(phase1Files.filter((file: string): boolean => file.endsWith('.json')).length, 0,
        'phase 1: no JSON output expected');

      // ── PHASE 2 ───────────────────────────────────────────────────────────
      const phase2Config = {
        ...baseFx,
        targets: {
          aonprd: {
            ...aonTarget,
            pipeline: ['html:fetch', 'aonprd:parse', 'json:write'],
            cache:    { dir: cacheDir, mode: 'read-only' as const },
          },
        },
      };

      const fetchCalls: string[] = [];
      const origFetch = globalThis.fetch;
      globalThis.fetch = ((...args: Parameters<typeof origFetch>) => {
        fetchCalls.push(String(args[0]));
        return origFetch(...args);
      }) as typeof fetch;

      try {
        await runHtml({
          target:    'aonprd',
          paths:     [...PROBES],
          outDir,
          configDir: resolve(__dirname, '..', '..'),
          config:    phase2Config,
        });
      } finally {
        globalThis.fetch = origFetch;
      }

      assert.equal(fetchCalls.length, 0,
        `phase 2 must not hit the network; saw: ${fetchCalls.join(', ')}`);

      const pluginDir   = resolve(targetDir, 'aonprd:parse');
      const phase2Files = (await readdir(pluginDir)).filter((file: string): boolean =>
        file.endsWith('.json') && file !== 'failures.json',
      );
      assert.ok(phase2Files.length === PROBES.length,
        `phase 2: expected ${PROBES.length.toString()} JSON files in aonprd:parse/, got ${phase2Files.length.toString()}`);
      for (const file of phase2Files) {
        const json = JSON.parse(await readFile(resolve(pluginDir, file), 'utf-8')) as {
          _type?: string; name?: string; source?: { book: string | null }; _raw?: unknown;
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
