// dnd5e-html e2e — Roll20 5e Compendium: HTML fetch + markdown output + JSDOM mode.
// Exercises:
//   - html:fetch → markdown:write pipeline via runDag
//   - useJsdom: true code path (same pipeline, JSDOM-processed HTML)
//
// Run locally:
//   npm run test:e2e -- --test-name-pattern='dnd5e-html'
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
const REPO_ROOT    = resolve(__dirname, '..', '..');
const FIXTURES_DIR = resolve(__dirname, 'fixtures');

const HTML_DAG_PATH    = resolve(__dirname, 'fixtures/dnd5e/dnd5e-html.dag.jsonld');
const STATE_PATH       = resolve(__dirname, 'fixtures/dnd5e/dnd5e.state.json');
const JSDOM_STATE_PATH = resolve(__dirname, 'fixtures/dnd5e/dnd5e-jsdom.state.json');

const SPELL_COUNT = 3;

describe('dnd5e-html e2e — Roll20 compendium HTML + markdown (local only)', () => {
  it(`fetches ${SPELL_COUNT.toString()} Roll20 spell pages and writes Markdown files`, async () => {
    const outDir = await mkdtemp(resolve(tmpdir(), 'ripper-dnd5e-html-'));
    try {
      const dag   = DAGDocument.load(readFileSync(HTML_DAG_PATH, 'utf-8'));
      const state = JSON.parse(readFileSync(STATE_PATH, 'utf-8')) as RunStateType;

      await runDag({ dag, state, outDir, configDir: FIXTURES_DIR });

      // splitByTaskName: false → files at <outDir>/<dag.name>/<slug>.md
      const targetDir = resolve(outDir, dag.name);
      const files     = await readdir(targetDir);
      const mdFiles   = files.filter((file): boolean => file.endsWith('.md'));

      process.stdout.write(`\n  dnd5e-html: ${mdFiles.length.toString()} markdown files written\n`);
      for (const file of mdFiles) {
        const content = await readFile(resolve(targetDir, file), 'utf-8');
        process.stdout.write(`    • ${file} (${content.length.toString()} chars)\n`);
        assert.ok(content.length > 100, `${file}: markdown content too short`);
      }

      assert.ok(mdFiles.length >= SPELL_COUNT,
        `expected ≥${SPELL_COUNT.toString()} .md files, got ${mdFiles.length.toString()}`);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('markdown output contains recognizable Roll20 spell content', async () => {
    const outDir = await mkdtemp(resolve(tmpdir(), 'ripper-dnd5e-md-'));
    try {
      const dag   = DAGDocument.load(readFileSync(HTML_DAG_PATH, 'utf-8'));
      const state = JSON.parse(readFileSync(STATE_PATH, 'utf-8')) as RunStateType;

      await runDag({ dag, state, outDir, configDir: FIXTURES_DIR });

      const targetDir = resolve(outDir, dag.name);
      const files     = await readdir(targetDir);
      const mdFiles   = files.filter((file): boolean => file.endsWith('.md'));
      assert.ok(mdFiles.length > 0, 'no markdown files written');

      const contents = await Promise.all(
        mdFiles.map((file) => readFile(resolve(targetDir, file), 'utf-8')),
      );
      const combined = contents.join('\n');

      // Roll20 SRD spell pages always include these headings/strings
      assert.ok(
        combined.toLowerCase().includes('fireball') || combined.includes('Evocation'),
        'expected fireball or Evocation in combined markdown output',
      );
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('useJsdom mode fetches and converts Roll20 spell pages without error', async () => {
    const outDir = await mkdtemp(resolve(tmpdir(), 'ripper-dnd5e-jsdom-'));
    try {
      const dag   = DAGDocument.load(readFileSync(HTML_DAG_PATH, 'utf-8'));
      const state = JSON.parse(readFileSync(JSDOM_STATE_PATH, 'utf-8')) as RunStateType;

      await runDag({ dag, state, outDir, configDir: FIXTURES_DIR });

      const targetDir = resolve(outDir, dag.name);
      const files     = await readdir(targetDir);
      const mdFiles   = files.filter((file): boolean => file.endsWith('.md'));

      process.stdout.write(`\n  dnd5e-jsdom: ${mdFiles.length.toString()} files (useJsdom: true)\n`);
      for (const file of mdFiles) {
        const content = await readFile(resolve(targetDir, file), 'utf-8');
        process.stdout.write(`    • ${file} (${content.length.toString()} chars)\n`);
        assert.ok(content.length > 50, `${file}: JSDOM markdown output too short`);
      }

      assert.ok(mdFiles.length >= SPELL_COUNT,
        `JSDOM mode: expected ≥${SPELL_COUNT.toString()} .md files, got ${mdFiles.length.toString()}`);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
