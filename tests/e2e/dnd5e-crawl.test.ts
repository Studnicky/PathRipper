// dnd5e-crawl e2e — D&D Wiki 5e SRD: crawl discovery + per-level concurrency + markdown output.
// Exercises:
//   - crawl:discover embedded DAG (BFS link discovery)
//   - crawler.concurrency: 3 (concurrent frontier fetches in FetchAndExtractLinksNode)
//   - dnd5e:page scatter (html:fetch → markdown:write) over discovered URLs
//
// Run locally:
//   npm run test:e2e -- --test-name-pattern='dnd5e-crawl'
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync }                from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { resolve, dirname }            from 'node:path';
import { tmpdir }                      from 'node:os';
import { fileURLToPath }               from 'node:url';

import { DAGDocument }      from '@studnicky/dagonizer';
import { runDag }           from '../../src/run/runDag.js';
import type { RunStateType } from '../../src/types/RunState.js';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, 'fixtures');

const CRAWL_DAG_PATH     = resolve(__dirname, 'fixtures/dnd5e/dnd5e-crawl.dag.jsonld');
const CRAWLER_STATE_PATH = resolve(__dirname, 'fixtures/dnd5e/dnd5e-crawler.state.json');

describe('dnd5e-crawl e2e — D&D Wiki SRD crawler + concurrency (local only)', () => {
  it('crawls D&D Wiki 5e SRD spells with concurrency 3 and writes Markdown files', async () => {
    const outDir = await mkdtemp(resolve(tmpdir(), 'ripper-dnd5e-crawl-'));
    try {
      const dag   = DAGDocument.load(readFileSync(CRAWL_DAG_PATH, 'utf-8'));
      const state = JSON.parse(readFileSync(CRAWLER_STATE_PATH, 'utf-8')) as RunStateType;

      await runDag({ dag, state, outDir, configDir: FIXTURES_DIR });

      // splitByTaskName: false → files at <outDir>/<dag.name>/<slug>.md
      const targetDir = resolve(outDir, dag.name);
      const files     = await readdir(targetDir);
      const mdFiles   = files.filter((file): boolean => file.endsWith('.md'));

      process.stdout.write(`\n  dnd5e-crawl: discovered and wrote ${mdFiles.length.toString()} SRD spell files\n`);
      for (const file of mdFiles.slice(0, 5)) {
        process.stdout.write(`    • ${file}\n`);
      }
      if (mdFiles.length > 5) {
        process.stdout.write(`    … and ${(mdFiles.length - 5).toString()} more\n`);
      }

      assert.ok(mdFiles.length >= 3,
        `expected ≥3 markdown files from SRD crawl, got ${mdFiles.length.toString()}`);

      // No failures manifest expected for a clean crawl run
      const hasFailed = files.includes('failures.json');
      if (hasFailed) {
        const manifest = JSON.parse(
          await readFile(resolve(targetDir, 'failures.json'), 'utf-8'),
        ) as { count: number };
        assert.equal(manifest.count, 0,
          `crawl produced ${manifest.count.toString()} failures`);
      }

      // Spot-check first file has meaningful content
      const firstFile = mdFiles[0];
      if (firstFile !== undefined) {
        const content = await readFile(resolve(targetDir, firstFile), 'utf-8');
        assert.ok(content.length > 100,
          `${firstFile}: crawled markdown file too short (${content.length.toString()} chars)`);
        process.stdout.write(`  first file: ${firstFile} — ${content.length.toString()} chars\n`);
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
