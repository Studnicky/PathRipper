// Familiar finalize node.
import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction } from '../../common.js';
import {
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../../common.js';
import type {
  FamiliarOutput,
  FamiliarBaseSlice,
  FamiliarPrerequisitesSlice,
  FamiliarAbilitiesSlice,
  FamiliarMetaSlice,
} from './types.js';

/**
 * AON labels lifted into structured fields by the per-slice helpers. The
 * residual `raw_fields` map drops these so it only surfaces unstructured
 * residue (e.g. spoiler tags on rare pages, "Range" on Activate effects).
 */
const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Ability Type',
  'Required Number of Abilities',
  'Granted Abilities',
  'Frequency',
  'Trigger',
  'Effect',
];

/**
 * Assemble the final FamiliarOutput from per-slice results. Computes
 * `raw_fields` by stripping CLAIMED_FIELD_LABELS and attaches sections /
 * body / links / meta fields owned by the full page.
 */
export function finalizeFamiliar(
  common:        CommonExtraction,
  base:          FamiliarBaseSlice,
  prerequisites: FamiliarPrerequisitesSlice,
  abilities:     FamiliarAbilitiesSlice,
  _meta:         FamiliarMetaSlice,
  root:          CheerioAPI,
): FamiliarOutput {
  void _meta;
  return {
    ...base,
    ability_type:                 prerequisites.ability_type,
    specific_familiar_parent:     prerequisites.specific_familiar_parent,
    required_number_of_abilities: prerequisites.required_number_of_abilities,
    granted_abilities:            prerequisites.granted_abilities,
    frequency:                    prerequisites.frequency,
    trigger:                      prerequisites.trigger,
    effect:                       prerequisites.effect,
    abilities:                    abilities.abilities,
    sections:                     common.sections,
    raw_fields:                   stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS),
    links:                        common.links,
    body_text:                    common.body_text,
    body_html:                    common.body_html,
    meta_description:             extractMetaDescription(root),
    meta_keywords:                extractMetaKeywords(root),
  } satisfies FamiliarOutput;
}
