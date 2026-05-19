// AON (Archives of Nethys, 2e.aonprd.com) HTML parse plugin — entry point.
//
// Exports:
//   - `register(dispatcher)` — explicit plugin contract. Called by `RipperRun`
//     after importing this module. Registers all constituent nodes and the DAG.
//   - `parseAonHtml(html, url)` — direct-call API for unit tests and consumers
//     that don't need the dispatcher.
//   - Individual node exports for tests that exercise nodes in isolation.

import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';

import type { RipperDagonizer }  from '../../src/dispatcher/RipperDagonizer.js';
import type { ScrapeState }      from '../../src/state/ScrapeState.js';
import type { RipperServices }   from '../../src/services/RipperServices.js';

import { detectPageType, extractCommon, loadHtml } from './common.js';
import { extractSpell, type SpellOutput }                                                         from './spell.js';
import { extractMonster, type MonsterOutput }                                                     from './monster.js';
import { extractFeat, type FeatOutput }                                                           from './feat.js';
import { extractWeapon, extractArmor, extractEquipment,
         type WeaponOutput, type ArmorOutput, type EquipmentOutput }                              from './equipment.js';
import { extractAction, type ActionOutput }                                                       from './action.js';
import { extractAncestry, extractClass, extractBackground,
         type AncestryOutput, type ClassOutput, type BackgroundOutput }                           from './character.js';
import { extractCondition, extractTrait, extractHazard, extractGeneric, makeUnknown,
         type ConditionOutput, type TraitOutput, type HazardOutput, type GenericOutput,
         type UnknownOutput }                                                                     from './world.js';

import {
  loadAndCommonNode,
  detectTypeNode,
  extractSpellNode,
  extractMonsterNode,
  extractFeatNode,
  extractWeaponNode,
  extractArmorNode,
  extractEquipmentNode,
  extractActionNode,
  extractAncestryNode,
  extractClassNode,
  extractBackgroundNode,
  extractConditionNode,
  extractTraitNode,
  extractHazardNode,
  extractGenericNode,
  unknownTerminalNode,
} from './nodes/index.js';
import { aonprdParseDAG } from './parse.dag.js';

/** Discriminated union of every typed output the AON parser produces. */
export type AonOutput =
  | SpellOutput
  | MonsterOutput
  | FeatOutput
  | WeaponOutput
  | ArmorOutput
  | EquipmentOutput
  | ActionOutput
  | AncestryOutput
  | ClassOutput
  | BackgroundOutput
  | ConditionOutput
  | TraitOutput
  | HazardOutput
  | GenericOutput
  | UnknownOutput;

/**
 * Parse a fully-loaded AON detail page and return a typed structured record.
 *
 * Exported for direct use by unit tests and downstream consumers that call the
 * extractor without going through the dispatcher / DAG machinery.
 */
export function parseAonHtml(html: string, url: string): AonOutput {
  const $ = loadHtml(html);
  const common = extractCommon($, url);
  if (common === null) return makeUnknown(url);

  const span = $('h1.title').first().closest('span');
  const target = span.find('span.monster-page').first().length > 0
    ? span.find('span.monster-page').first()
    : span;

  const type = detectPageType(url);
  switch (type) {
    case 'spell':
    case 'ritual':     return extractSpell(common, $, target);
    case 'monster':    return extractMonster(common, $, target);
    case 'feat':       return extractFeat(common, $, target);
    case 'weapon':     return extractWeapon(common, $, target);
    case 'armor':
    case 'shield':     return extractArmor(common, $, target);
    case 'equipment':  return extractEquipment(common, $, target);
    case 'action':     return extractAction(common, $, target);
    case 'ancestry':   return extractAncestry(common, $, target);
    case 'class':      return extractClass(common, $, target);
    case 'background': return extractBackground(common, $, target);
    case 'condition':  return extractCondition(common, $, target);
    case 'trait':      return extractTrait(common, $, target);
    case 'hazard':     return extractHazard(common, $, target);
    case 'deity':
    case 'archetype':
    case 'generic':    return extractGeneric(common, $, target);
    case 'unknown':    return extractGeneric(common, $, target);
  }
}

// ── Plugin contract ────────────────────────────────────────────────────────────

/**
 * Explicit plugin registration. Called by `RipperRun` after importing this module.
 * Registers all constituent nodes and the `aonprd:parse` DAG on the dispatcher.
 *
 * @param dispatcher - The `RipperDagonizer` instance for the current scrape run.
 */
export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
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
  dispatcher.registerDAG(aonprdParseDAG);
}

// ── Legacy single-node export (kept for tests that reference aonprdParseNode) ─
// The node itself is not registered by default — use parseAonHtml() for direct
// calls or register(dispatcher) for pipeline integration.
export const aonprdParseNode: NodeInterface<ScrapeState, 'success' | 'error' | 'unknown', RipperServices> = {
  name:    'aonprd:parse',
  outputs: ['success', 'error', 'unknown'],

  async execute(
    state:   ScrapeState,
    _context: NodeContextInterface<RipperServices>,
  ): Promise<{ output: 'success' | 'error' | 'unknown' }> {
    const html = state.page.html;
    if (html === undefined) { return { output: 'unknown' }; }
    const output = parseAonHtml(html, state.page.url);
    state.output = output as unknown as Record<string, unknown>;
    return { output: 'success' };
  },
};
