// Animal-companion finalize node.
import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction } from '../../common.js';
import {
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../../common.js';
import type {
  AnimalCompanionOutput,
  AnimalCompanionBaseSlice,
  AnimalCompanionStatsSlice,
  AnimalCompanionCombatSlice,
  AnimalCompanionAdvancementSlice,
  AnimalCompanionMetaSlice,
} from './types.js';

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Size', 'Melee', 'Ranged', 'Damage',
  'Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha',
  'Hit Points', 'Skill', 'Senses', 'Speed',
  'Support Benefit', 'Advanced Maneuver',
  'Base Animal Companion',
  // Advancement-tier rider fields and inline maneuver labels.
  'Special', 'Requirements', 'Access', 'Frequency', 'Trigger',
  'Unsteady Mount', 'Motion Sense',
];

export function finalizeAnimalCompanion(
  common:       CommonExtraction,
  base:         AnimalCompanionBaseSlice,
  stats:        AnimalCompanionStatsSlice,
  combat:       AnimalCompanionCombatSlice,
  advancement:  AnimalCompanionAdvancementSlice,
  _meta:        AnimalCompanionMetaSlice,
  root:         CheerioAPI,
): AnimalCompanionOutput {
  void _meta;
  const raw_fields = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    ...stats,
    ...combat,
    advanced_maneuver_action_cost: advancement.advanced_maneuver_action_cost,
    advanced_maneuver_body:        advancement.advanced_maneuver_body,
    modifications:                 advancement.modifications,
    sections:        common.sections,
    raw_fields,
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies AnimalCompanionOutput;
}
