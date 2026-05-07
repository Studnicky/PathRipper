// AON (Archives of Nethys, 2e.aonprd.com) HTML parse plugin — entry point.
//
// This is the HTML-side counterpart to plugins/bulbapedia/parse.task.ts.
// It dispatches by URL path to per-type extractors, each of which projects a
// typed structured output on top of the shared CommonExtraction harvest in
// ./common.ts. The shared foundation always captures every header label/value
// pair, every `<h{2,3}>` section, every internal cross-reference link, and the
// raw body HTML — so even when a per-type extractor doesn't recognize a page,
// no on-page data is silently dropped.
//
// Self-registers as `aonprd:parse` via TaskRegistry on import.
import { TaskRegistry } from '../../dist/registry/TaskRegistry.js';
import type { PipelineStateInterface } from '../../dist/registry/PipelineState.js';
import type { TaskFnInterface } from '../../dist/pipeline/Pipeline.js';

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
 * Exported for direct use by unit tests and downstream consumers; the registered
 * pipeline task wraps this and writes the result into `state.output`.
 */
export function parseAonHtml(html: string, url: string): AonOutput {
  const $ = loadHtml(html);
  const common = extractCommon($, url);
  if (common === null) return makeUnknown(url);

  // Re-locate the same span the foundation used so the per-type extractor can
  // walk its DOM where regex over HTML isn't enough. We mirror common.ts logic.
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

const task: TaskFnInterface<PipelineStateInterface> = async (next, state) => {
  const html = state.page.html;
  if (html === undefined) { await next(); return; }
  const output = parseAonHtml(html, state.page.url);
  state.output = output as unknown as Record<string, unknown>;
  await next();
};

TaskRegistry.register('aonprd:parse', task);
