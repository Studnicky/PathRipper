// Animal-companion finalize node.
import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction } from '../../common.js';
import {
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../../common.js';
import type {
  AnimalCompanionOutputFields,
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
  c:            CommonExtraction,
  base:         AnimalCompanionBaseSlice,
  stats:        AnimalCompanionStatsSlice,
  combat:       AnimalCompanionCombatSlice,
  advancement:  AnimalCompanionAdvancementSlice,
  _meta:        AnimalCompanionMetaSlice,
  $:            CheerioAPI,
): AnimalCompanionOutputFields {
  void _meta;
  const raw_fields = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    ...stats,
    ...combat,
    advanced_maneuver_action_cost: advancement.advanced_maneuver_action_cost,
    advanced_maneuver_body:        advancement.advanced_maneuver_body,
    modifications:                 advancement.modifications,
    sections:        c.sections,
    raw_fields,
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies AnimalCompanionOutputFields;
}
