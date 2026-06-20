/**
 * render-dags.mjs
 *
 * VitePress build-time script: enumerates every registered DAG via
 * `dispatcher.listDAGs()` and writes Mermaid source files to docs/_generated/.
 *
 * Invoked by `npm run docs:build` via `node --import tsx` so TypeScript
 * imports from src/ resolve correctly.
 *
 * Architecture.md uses VitePress @include directives to embed each .mmd file
 * inside a mermaid fenced block. The filename for each DAG is looked up in
 * `DAG_FILENAME_MAP`; DAG names not found in the map fall back to
 * `${dag.name.replace(/:/g, '-').replace(/\//g, '-')}.mmd`.
 *
 * `registerAllFlows` imports from `src/flows/` and renders the DAGBuilder-based
 * flow shapes for all built-in DAGs.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname }  from 'node:path';
import { fileURLToPath }     from 'node:url';

import { Dagonizer }         from '@noocodex/dagonizer';
import { MermaidRenderer }   from '@noocodex/dagonizer/viz';

// Core registrations (src/-level only — stays within TypeScript rootDir).
import { registerAllFlows, DAG_FILENAME_MAP } from '../../../src/flows/registerAllFlows.js';

// Plugin nodes and DAGs (outside src/ rootDir — registered here, not in registerAllFlows).
import { loadAndCommonNode }     from '../../../plugins/aonprd/nodes/loadAndCommon.js';
import { detectTypeNode }        from '../../../plugins/aonprd/nodes/detectType.js';
import { extractSpellNode }      from '../../../plugins/aonprd/nodes/extractSpell.js';
import { extractMonsterNode }    from '../../../plugins/aonprd/nodes/extractMonster.js';
import { extractFeatNode }       from '../../../plugins/aonprd/nodes/extractFeat.js';
import { extractWeaponNode }     from '../../../plugins/aonprd/nodes/extractWeapon.js';
import { extractArmorNode }      from '../../../plugins/aonprd/nodes/extractArmor.js';
import { extractEquipmentNode }  from '../../../plugins/aonprd/nodes/extractEquipment.js';
import { extractActionNode }     from '../../../plugins/aonprd/nodes/extractAction.js';
import { extractAncestryNode }   from '../../../plugins/aonprd/nodes/extractAncestry.js';
import { extractClassNode }      from '../../../plugins/aonprd/nodes/extractClass.js';
import { extractBackgroundNode } from '../../../plugins/aonprd/nodes/extractBackground.js';
import { extractConditionNode }  from '../../../plugins/aonprd/nodes/extractCondition.js';
import { extractTraitNode }      from '../../../plugins/aonprd/nodes/extractTrait.js';
import { extractHazardNode }     from '../../../plugins/aonprd/nodes/extractHazard.js';
import { extractGenericNode }    from '../../../plugins/aonprd/nodes/extractGeneric.js';
import { unknownTerminalNode }   from '../../../plugins/aonprd/nodes/unknownTerminal.js';
import { aonprdParseDAG }        from '../../../plugins/aonprd/parse.dag.js';

import { docsParseNode, docsParseFlow as docsParseDAG }           from '../../../examples/docs-scraper/plugin.js';
import { wikiDocsParseNode, wikiDocsParseFlow as wikiDocsParseDAG } from '../../../examples/wiki-docs/plugin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR   = resolve(__dirname, '../../_generated');

await mkdir(OUT_DIR, { recursive: true });

// Build a dispatcher and register every application DAG without executing them.
const dispatcher = new Dagonizer({});

// Built-in + core DAGs.
registerAllFlows(dispatcher);

// Plugin nodes (outside src/ rootDir — imported here to avoid tsconfig rootDir violation).
dispatcher.registerNode(loadAndCommonNode);
dispatcher.registerNode(detectTypeNode);
dispatcher.registerNode(extractSpellNode);
dispatcher.registerNode(extractMonsterNode);
dispatcher.registerNode(extractFeatNode);
dispatcher.registerNode(extractWeaponNode);
dispatcher.registerNode(extractArmorNode);
dispatcher.registerNode(extractEquipmentNode);
dispatcher.registerNode(extractActionNode);
dispatcher.registerNode(extractAncestryNode);
dispatcher.registerNode(extractClassNode);
dispatcher.registerNode(extractBackgroundNode);
dispatcher.registerNode(extractConditionNode);
dispatcher.registerNode(extractTraitNode);
dispatcher.registerNode(extractHazardNode);
dispatcher.registerNode(extractGenericNode);
dispatcher.registerNode(unknownTerminalNode);
dispatcher.registerNode(docsParseNode);
dispatcher.registerNode(wikiDocsParseNode);

// Plugin DAGs.
dispatcher.registerDAG(aonprdParseDAG);
dispatcher.registerDAG(docsParseDAG);
dispatcher.registerDAG(wikiDocsParseDAG);

// Render every registered DAG to its .mmd file.
const dags = dispatcher.listDAGs();

for (const dag of dags) {
  const filename = DAG_FILENAME_MAP.get(dag.name)
    ?? `${dag.name.replace(/:/g, '-').replace(/\//g, '-')}.mmd`;
  const mermaid  = MermaidRenderer.render(dag);
  await writeFile(resolve(OUT_DIR, filename), mermaid, 'utf8');
  process.stdout.write(`  wrote ${filename}\n`);
}

process.stdout.write(`Rendered ${dags.length.toString()} DAG diagrams to docs/_generated/\n`);
