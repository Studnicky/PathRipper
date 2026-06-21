/**
 * render-dags.mjs
 *
 * VitePress build-time script: writes Mermaid source files to docs/_generated/,
 * one per DAG this application ships.
 *
 * Invoked by `npm run docs:build` via `node --import tsx` so TypeScript
 * imports from src/, plugins/, and examples/ resolve correctly.
 *
 * Only plugin and example DAGs are rendered here — they are rendered directly
 * from their exported `DAGType` objects. `MermaidRenderer.render(dag)` needs
 * only the DAG shape, not the node implementations.
 *
 * architecture.md and aonprd-scraper-dag.md embed generated .mmd files via
 * VitePress @include directives. The generated files produced here are:
 *   - aonprdParseDAG.mmd  (plugins/aonprd/parse.dag.ts)
 *   - docsScraperDAG.mmd  (examples/docs-scraper/plugin.ts)
 *   - wikiDocsDAG.mmd     (examples/wiki-docs/plugin.ts)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname }  from 'node:path';
import { fileURLToPath }     from 'node:url';

import { MermaidRenderer }   from '@studnicky/dagonizer/viz';

// Plugin + example DAGs — rendered directly from their DAGType (no node registry).
import { aonprdParseDAG }                  from '../../../plugins/aonprd/parse.dag.js';
import { docsParseFlow as docsParseDAG }   from '../../../examples/docs-scraper/plugin.js';
import { wikiDocsParseFlow as wikiDocsParseDAG } from '../../../examples/wiki-docs/plugin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR   = resolve(__dirname, '../../_generated');

await mkdir(OUT_DIR, { recursive: true });

/** Filename map for DAGs whose generated filename differs from the default. */
const FILENAME_MAP = new Map([
  ['docs:parse',       'docsScraperDAG.mmd'],
  ['wiki-docs:parse',  'wikiDocsDAG.mmd'],
  ['aonprd:parse',     'aonprdParseDAG.mmd'],
]);

const filenameFor = (dag) =>
  FILENAME_MAP.get(dag.name) ?? `${dag.name.replace(/:/g, '-').replace(/\//g, '-')}.mmd`;

const writeDag = async (dag) => {
  const filename = filenameFor(dag);
  await writeFile(resolve(OUT_DIR, filename), MermaidRenderer.render(dag), 'utf8');
  process.stdout.write(`  wrote ${filename}\n`);
};

const dags = [aonprdParseDAG, docsParseDAG, wikiDocsParseDAG];
for (const dag of dags) await writeDag(dag);

process.stdout.write(
  `Rendered ${dags.length.toString()} DAG diagrams to docs/_generated/\n`,
);
