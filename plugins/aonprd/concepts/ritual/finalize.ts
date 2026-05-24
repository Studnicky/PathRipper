/**
 * Ritual concept — finalization.
 *
 * Assembles the final RitualOutput from per-slice results and attaches
 * raw_fields, links, and meta tags.
 * Node: finalize:ritual
 */
import type { NodeInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import { stripStructuredKeys, extractMetaDescription, extractMetaKeywords } from '../../common.js';
import { setConceptOutput } from '../_helpers.js';

import type { SpellOutput, RitualBaseSlice, RitualCastSlice, RitualOutcomesSlice, RitualAfflictionSlice, RitualHeightenedSlice, RitualMetaSlice } from './types.js';

/**
 * AON labels every per-slice helper has lifted into structured fields.
 *
 * Listed in slice order for maintenance clarity. Includes singular / plural
 * variants because individual spell pages may use either form (Deity vs.
 * Deities, Cult vs. Cults).
 */
const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Cast', 'Trigger', 'Range', 'Area', 'Targets', 'Target', 'Target(s)',
  'Defense', 'Saving Throw', 'Duration', 'Cost', 'Requirements',
  'Primary Check', 'Secondary Casters', 'Secondary Checks',
  'Traditions', 'Tradition', 'Spell List',
  'Bloodline', 'Bloodlines', 'Cult', 'Cults', 'Domain', 'Domains',
  'Deity', 'Deities', 'Mystery', 'Mysteries',
  'Patron Theme', 'Patron Themes', 'Catalyst', 'Catalysts',
  'Lesson', 'Lessons', 'Access',
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
  base:       RitualBaseSlice,
  cast:       RitualCastSlice,
  outcomes:   RitualOutcomesSlice,
  affliction: RitualAfflictionSlice,
  heightened: RitualHeightenedSlice,
  meta:       RitualMetaSlice,
  $:          CheerioAPI,
): SpellOutput {
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
  } satisfies SpellOutput;
}

export type FinalizeRitualOutput = 'success';

export const finalizeRitualNode: NodeInterface<ScrapeState, FinalizeRitualOutput, RipperServices> = {
  name:    'finalize:ritual',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
  ): Promise<{ output: FinalizeRitualOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };
    const acc = (state.output ?? {}) as unknown as SpellOutput;
    void target;
    const assembled = finalizeSpell(c, acc, acc, acc, acc, acc, acc, $);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};
