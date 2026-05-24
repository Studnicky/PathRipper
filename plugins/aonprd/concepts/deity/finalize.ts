// finalize:deity — assemble complete output from all slices.

import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import {
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../../common.js';
import type {
  DeityOutput,
  DeityBaseSlice,
  DeityDevoteeBenefitsSlice,
  DeityEdictsAnathemaSlice,
  DeityClericSpellsSlice,
  DeityRelationshipsSlice,
  DeityMetaSlice,
} from './types.js';

/**
 * AON labels claimed by upstream deity slices. The deity field map is usually
 * empty (no `<hr/>` separator means labels stay in `body_html`), but PFS
 * tagging and pre-Remaster pages can populate `field_map` with `Source` and
 * the lore labels — strip them here so `raw_fields` contains only residue.
 */
const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  // Lore/edicts slice
  'Category', 'Edicts', 'Anathema', 'Areas of Concern',
  'Follower Alignments', 'Religious Symbol', 'Sacred Animal',
  'Sacred Color(s)', 'Sacred Colors', 'Pantheons/Covenants', 'Pantheons',
  // Devotee Benefits slice
  'Divine Attribute', 'Divine Font', 'Divine Sanctification', 'Divine Skill',
  'Favored Weapon', 'Domains', 'Alternate Domains',
  // Cleric Spells / Intercession slices
  'Cleric Spells',
  'Minor Boon', 'Moderate Boon', 'Major Boon',
  'Minor Curse', 'Moderate Curse', 'Major Curse',
];

export function finalizeDeity(
  c:         CommonExtraction,
  base:      DeityBaseSlice,
  devotee:   DeityDevoteeBenefitsSlice,
  edicts:    DeityEdictsAnathemaSlice,
  spells:    DeityClericSpellsSlice,
  rels:      DeityRelationshipsSlice,
  _meta:     DeityMetaSlice,
  $:         CheerioAPI,
  _target:   CheerioNode,
): DeityOutput {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    ...devotee,
    ...edicts,
    cleric_spells:       spells.cleric_spells,
    intercessions:       spells.intercessions,
    deity_relationships: rels.deity_relationships,
    sections:            c.sections,
    raw_fields,
    links:               c.links,
    body_text:           c.body_text,
    body_html:           c.body_html,
    meta_description:    extractMetaDescription($),
    meta_keywords:       extractMetaKeywords($),
  } satisfies DeityOutput;
}
