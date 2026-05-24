/**
 * Spell concept — finalize logic.
 *
 * Strips all claimed field-map keys, attaches links, body_text/html, and meta tags.
 * Recomputes from all slice helpers so the full picture of claimed labels is available
 * at strip time. Node: finalize:spell
 */
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import {
  CAPABILITY_OUTPUTS,
  stripStructuredKeys,
  extractMetaDescription,
  extractMetaKeywords,
} from '../../common.js';
import { setConceptOutput } from '../_helpers.js';

import type {
  SpellOutput,
  SpellOutputFields,
  SpellBaseSlice,
  SpellCastSlice,
  SpellOutcomesSlice,
  SpellAfflictionSlice,
  SpellHeightenedSlice,
  SpellMetaSlice,
} from './types.js';
import { extractSpellBase } from './base.js';
import { extractSpellCast } from './cast.js';
import { extractSpellOutcomes } from './outcomes.js';
import { extractSpellAffliction } from './affliction.js';
import { extractSpellHeightened } from './heightened.js';
import { extractSpellMeta } from './meta.js';

/**
 * AON labels every per-slice helper has lifted into structured fields.
 *
 * Listed in slice order for maintenance clarity. Includes singular / plural
 * variants because individual spell pages may use either form (Deity vs.
 * Deities, Cult vs. Cults).
 */
const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  // Cast slice
  'Cast', 'Trigger', 'Range', 'Area', 'Targets', 'Target', 'Target(s)',
  'Defense', 'Saving Throw', 'Duration', 'Cost', 'Requirements',
  // Affliction / ritual slice
  'Primary Check', 'Secondary Casters', 'Secondary Checks',
  // Meta slice
  'Traditions', 'Tradition', 'Spell List',
  'Bloodline', 'Bloodlines', 'Cult', 'Cults', 'Domain', 'Domains',
  'Deity', 'Deities', 'Mystery', 'Mysteries',
  'Patron Theme', 'Patron Themes', 'Catalyst', 'Catalysts',
  'Lesson', 'Lessons', 'Access',
  // Base slice (header source label)
  'Source',
];

/**
 * Assemble the final SpellOutput from per-slice results.
 *
 * Computes `raw_fields` by stripping every label claimed by upstream slices
 * (CLAIMED_FIELD_LABELS) plus every `Heightened (Xth)` field-map key already
 * absorbed by the heightened slice. Attaches body-derived links + meta tags.
 */
export function finalizeSpell(
  c:          CommonExtraction,
  base:       SpellBaseSlice,
  cast:       SpellCastSlice,
  outcomes:   SpellOutcomesSlice,
  affliction: SpellAfflictionSlice,
  heightened: SpellHeightenedSlice,
  meta:       SpellMetaSlice,
  $:          CheerioAPI,
  _span:      CheerioNode,
): SpellOutputFields {
  // Heightened field-map keys appear as `Heightened (5th)`, `Heightened (+2)`,
  // etc. — capture every key that begins with "Heightened" for stripping.
  const heightenedKeys: string[] = [];
  for (const key of Object.keys(c.field_map)) {
    if (/^heightened\b/i.test(key)) heightenedKeys.push(key);
  }

  const raw_fields = stripStructuredKeys(c.field_map, [
    ...CLAIMED_FIELD_LABELS,
    ...heightenedKeys,
  ]);

  return {
    ...base,
    ...cast,
    ...outcomes,
    ...affliction,
    ...heightened,
    ...meta,
    raw_fields,
    links:            c.links,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies SpellOutputFields;
}

export type FinalizeSpellOutput = 'success';

export const finalizeSpellNode: NodeInterface<ScrapeState, FinalizeSpellOutput, RipperServices> = {
  name:    'finalize:spell',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeSpellOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };
    const acc = (state.output ?? {}) as unknown as SpellOutput;
    const assembled = finalizeSpell(c, acc, acc, acc, acc, acc, acc, $, target);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};
