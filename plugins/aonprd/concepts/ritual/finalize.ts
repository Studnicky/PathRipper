/**
 * Ritual concept — finalization.
 *
 * Assembles the final RitualOutput from per-slice results and attaches
 * raw_fields, links, and meta tags.
 * Node: finalize:ritual
 */
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
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
  common:     CommonExtraction,
  base:       RitualBaseSlice,
  cast:       RitualCastSlice,
  outcomes:   RitualOutcomesSlice,
  affliction: RitualAfflictionSlice,
  heightened: RitualHeightenedSlice,
  meta:       RitualMetaSlice,
  root:       CheerioAPI,
): SpellOutput {
  const heightenedKeys: string[] = [];
  for (const key of Object.keys(common.field_map)) {
    if (/^heightened\b/i.test(key)) heightenedKeys.push(key);
  }

  const raw_fields = stripStructuredKeys(common.field_map, [
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
    links:            common.links,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies SpellOutput;
}

export type FinalizeRitualOutput = 'success';

class FinalizeRitualNode extends ScalarNode<ScrapeState, FinalizeRitualOutput> {
  public readonly name = 'finalize:ritual';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<FinalizeRitualOutput, SchemaObjectType> {
    return {
      // setConceptOutput writes fully assembled SpellOutput to state.output
      success: { type: 'object', properties: { output: { type: 'object' } }, required: ['output'] },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeRitualOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('success');
    const acc = (state.output ?? {}) as unknown as SpellOutput;
    void target;
    const assembled = finalizeSpell(common, acc, acc, acc, acc, acc, acc, root);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeRitualNode = new FinalizeRitualNode();
