/**
 * render-dags.mjs
 *
 * VitePress build-time script: writes Mermaid source files to docs/_generated/,
 * one per DAG this application ships.
 *
 * Invoked by `npm run docs:build` via `node --import tsx` so TypeScript
 * imports from src/, plugins/, and examples/ resolve correctly.
 *
 * Two rendering paths:
 *   - Core/src DAGs are registered into a `Dagonizer` via `registerAllFlows`
 *     and enumerated with `dispatcher.listDAGs()`. Registration validates every
 *     placement against the node registry, so these diagrams are guaranteed to
 *     match runnable DAGs.
 *   - Plugin and example DAGs are rendered directly from their exported
 *     `DAGType` objects. `MermaidRenderer.render(dag)` needs only the DAG shape,
 *     not the node implementations, so plugin node modules do not need to be
 *     imported or registered here.
 *
 * architecture.md embeds each .mmd file inside a mermaid fenced block via
 * VitePress @include directives. The filename for each DAG comes from
 * `DAG_FILENAME_MAP`; names absent from the map fall back to
 * `${name.replace(/:/g, '-').replace(/\//g, '-')}.mmd`.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname }  from 'node:path';
import { fileURLToPath }     from 'node:url';

import { Dagonizer }         from '@studnicky/dagonizer';
import { MermaidRenderer }   from '@studnicky/dagonizer/viz';

// Core registrations (src/-level only — stays within TypeScript rootDir).
import { registerAllFlows, DAG_FILENAME_MAP } from '../../../src/flows/registerAllFlows.js';
import { buildHtmlPageFlow }                  from '../../../src/flows/htmlPageFlow.js';

// Plugin + example DAGs — rendered directly from their DAGType (no node registry).
import { aonprdParseDAG }                  from '../../../plugins/aonprd/parse.dag.js';
import { docsParseFlow as docsParseDAG }   from '../../../examples/docs-scraper/plugin.js';
import { wikiDocsParseFlow as wikiDocsParseDAG } from '../../../examples/wiki-docs/plugin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR   = resolve(__dirname, '../../_generated');

await mkdir(OUT_DIR, { recursive: true });

const filenameFor = (name) =>
  DAG_FILENAME_MAP.get(name) ?? `${name.replace(/:/g, '-').replace(/\//g, '-')}.mmd`;

const writeDag = async (dag) => {
  const filename = filenameFor(dag.name);
  await writeFile(resolve(OUT_DIR, filename), MermaidRenderer.render(dag), 'utf8');
  process.stdout.write(`  wrote ${filename}\n`);
};

// ── Core/src DAGs via the dispatcher registry ────────────────────────────────
const dispatcher = new Dagonizer({});
registerAllFlows(dispatcher);
const coreDags = dispatcher.listDAGs();
for (const dag of coreDags) await writeDag(dag);

// ── Plugin + example DAGs rendered directly from their DAGType ────────────────
const pluginDags = [aonprdParseDAG, docsParseDAG, wikiDocsParseDAG];
for (const dag of pluginDags) await writeDag(dag);

// ── AONPRD-specific per-page DAG (the real aonprd pipeline) ───────────────────
// The canonical htmlPageDAG uses a representative pipeline; this one renders the
// exact steps the aonprd target runs so the scraper walkthrough is concrete.
const aonprdPageDAG = buildHtmlPageFlow(['html:fetch', 'aonprd:parse', 'json:write'], 'aonprd');
await writeFile(resolve(OUT_DIR, 'aonprdPageDAG.mmd'), MermaidRenderer.render(aonprdPageDAG), 'utf8');
process.stdout.write('  wrote aonprdPageDAG.mmd\n');

process.stdout.write(
  `Rendered ${(coreDags.length + pluginDags.length + 1).toString()} DAG diagrams to docs/_generated/\n`,
);
