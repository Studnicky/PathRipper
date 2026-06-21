/**
 * Spell concept — finalize logic.
 *
 * Strips all claimed field-map keys, attaches links, body_text/html, and meta tags.
 * Recomputes from all slice helpers so the full picture of claimed labels is available
 * at strip time. Node: finalize:spell
 */
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import {
  stripStructuredKeys,
  extractMetaDescription,
  extractMetaKeywords,
} from '../../common.js';
import { setConceptOutput } from '../_helpers.js';

import type {
  SpellOutput,
  SpellBaseSlice,
  SpellCastSlice,
  SpellOutcomesSlice,
  SpellAfflictionSlice,
  SpellHeightenedSlice,
  SpellMetaSlice,
} from './types.js';

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
  common:     CommonExtraction,
  base:       SpellBaseSlice,
  cast:       SpellCastSlice,
  outcomes:   SpellOutcomesSlice,
  affliction: SpellAfflictionSlice,
  heightened: SpellHeightenedSlice,
  meta:       SpellMetaSlice,
  root:       CheerioAPI,
  _span:      CheerioNode,
): SpellOutput {
  // Heightened field-map keys appear as `Heightened (5th)`, `Heightened (+2)`,
  // etc. — capture every key that begins with "Heightened" for stripping.
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

export type FinalizeSpellOutput = 'success';

class FinalizeSpellNode extends ScalarNode<ScrapeState, FinalizeSpellOutput> {
  public readonly name    = 'finalize:spell';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<'success', SchemaObjectType> {
    return {
      // `success` — state.output set to full SpellOutput via setConceptOutput
      success: {
        type: 'object',
        properties: {
          output: { type: 'object' },
        },
        required: ['output'],
      },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeSpellOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root   = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('success');
    const acc = (state.output ?? {}) as unknown as SpellOutput;
    const assembled = finalizeSpell(common, acc, acc, acc, acc, acc, acc, root, target);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeSpellNode = new FinalizeSpellNode();
