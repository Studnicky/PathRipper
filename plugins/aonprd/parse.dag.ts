// Plugin DAG: aonprd:parse
// Decomposes the monolithic aonprd parse node into a branching sub-flow:
//   load-and-common → detect-type → branch (15 page types) → extract-<type> → terminate
// The DAG name 'aonprd:parse' matches the pipeline-config entry so existing
// user configs work without modification — the orchestrator resolves it via
// the global DAG registry instead of the node registry.
import { DAGBuilder } from '@noocodex/dagonizer/builder';
import type { DAG }   from '@noocodex/dagonizer';

import { loadAndCommonNode }     from './nodes/loadAndCommon.js';
import { detectTypeNode }        from './nodes/detectType.js';
import { extractSpellNode }      from './nodes/extractSpell.js';
import { extractMonsterNode }    from './nodes/extractMonster.js';
import { extractFeatNode }       from './nodes/extractFeat.js';
import { extractWeaponNode }     from './nodes/extractWeapon.js';
import { extractArmorNode }      from './nodes/extractArmor.js';
import { extractEquipmentNode }  from './nodes/extractEquipment.js';
import { extractActionNode }     from './nodes/extractAction.js';
import { extractAncestryNode }   from './nodes/extractAncestry.js';
import { extractClassNode }      from './nodes/extractClass.js';
import { extractBackgroundNode } from './nodes/extractBackground.js';
import { extractConditionNode }  from './nodes/extractCondition.js';
import { extractTraitNode }      from './nodes/extractTrait.js';
import { extractHazardNode }     from './nodes/extractHazard.js';
import { extractGenericNode }    from './nodes/extractGeneric.js';
import { unknownTerminalNode }   from './nodes/unknownTerminal.js';
import { TerminalNode }          from '../../src/nodes/TerminalNode.js';

// ── Stub wrappers ─────────────────────────────────────────────────────────────
// DAGBuilder.node() needs the node object for type inference, but the real
// nodes are registered on the dispatcher separately. We pass the real node
// objects here because the DAG is built once and used at registration time.

/**
 * Builds the `aonprd:parse` plugin DAG.
 *
 * Shape:
 *   load-and-common → detect-type → {
 *     spell       → extract-spell      → terminate
 *     monster     → extract-monster    → terminate
 *     feat        → extract-feat       → terminate
 *     weapon      → extract-weapon     → terminate
 *     armor       → extract-armor      → terminate
 *     equipment   → extract-equipment  → terminate
 *     action      → extract-action     → terminate
 *     ancestry    → extract-ancestry   → terminate
 *     class       → extract-class      → terminate
 *     background  → extract-background → terminate
 *     condition   → extract-condition  → terminate
 *     trait       → extract-trait      → terminate
 *     hazard      → extract-hazard     → terminate
 *     generic     → extract-generic    → terminate
 *     unknown     → make-unknown       → terminate
 *   }
 *   load-and-common(error) → make-unknown → terminate
 *
 * The DAG name 'aonprd:parse' is the pipeline-config step name — unchanged from
 * the pre-decomposition single-node version.
 *
 * @category Plugin DAGs
 * @since 3.0.0
 */
export const aonprdParseDAG: DAG = new DAGBuilder('aonprd:parse', '1.0')
  // ── Load + shared extraction ────────────────────────────────────────────────
  .node(
    'load-and-common',
    loadAndCommonNode,
    { success: 'detect-type', error: 'make-unknown' },
  )
  // ── Type detection ──────────────────────────────────────────────────────────
  .node(
    'detect-type',
    detectTypeNode,
    {
      spell:      'extract-spell',
      monster:    'extract-monster',
      feat:       'extract-feat',
      weapon:     'extract-weapon',
      armor:      'extract-armor',
      equipment:  'extract-equipment',
      action:     'extract-action',
      ancestry:   'extract-ancestry',
      class:      'extract-class',
      background: 'extract-background',
      condition:  'extract-condition',
      trait:      'extract-trait',
      hazard:     'extract-hazard',
      generic:    'extract-generic',
      unknown:    'make-unknown',
    },
  )
  // ── Per-type extractors ─────────────────────────────────────────────────────
  .node('extract-spell',      extractSpellNode,      { success: 'terminate', error: 'make-unknown' })
  .node('extract-monster',    extractMonsterNode,    { success: 'terminate', error: 'make-unknown' })
  .node('extract-feat',       extractFeatNode,       { success: 'terminate', error: 'make-unknown' })
  .node('extract-weapon',     extractWeaponNode,     { success: 'terminate', error: 'make-unknown' })
  .node('extract-armor',      extractArmorNode,      { success: 'terminate', error: 'make-unknown' })
  .node('extract-equipment',  extractEquipmentNode,  { success: 'terminate', error: 'make-unknown' })
  .node('extract-action',     extractActionNode,     { success: 'terminate', error: 'make-unknown' })
  .node('extract-ancestry',   extractAncestryNode,   { success: 'terminate', error: 'make-unknown' })
  .node('extract-class',      extractClassNode,      { success: 'terminate', error: 'make-unknown' })
  .node('extract-background', extractBackgroundNode, { success: 'terminate', error: 'make-unknown' })
  .node('extract-condition',  extractConditionNode,  { success: 'terminate', error: 'make-unknown' })
  .node('extract-trait',      extractTraitNode,      { success: 'terminate', error: 'make-unknown' })
  .node('extract-hazard',     extractHazardNode,     { success: 'terminate', error: 'make-unknown' })
  .node('extract-generic',    extractGenericNode,    { success: 'terminate', error: 'make-unknown' })
  // ── Unknown / fallback ──────────────────────────────────────────────────────
  .node('make-unknown', unknownTerminalNode, { success: 'terminate' })
  // ── Terminator — DAGs cannot route to null from a non-terminal node ─────────
  .node('terminate', TerminalNode, { success: null })
  .build();
