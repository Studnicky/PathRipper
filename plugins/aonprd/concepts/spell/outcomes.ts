/**
 * Spell concept — outcomes slice extraction.
 *
 * Extract description prose + Critical Success / Success / Failure / Critical Failure blocks.
 * Node: extract:spell-outcomes
 */
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { CommonExtraction } from '../../common.js';
import { CAPABILITY_OUTPUTS, htmlToText } from '../../common.js';

import type { SpellOutcomesSlice } from './types.js';
import { findDescriptionBoundary, parseOutcomes } from './helpers.js';

/** Extract description prose + save-tier outcomes from the body HTML. */
export function extractSpellOutcomes(common: CommonExtraction): SpellOutcomesSlice {
  const bodyHtml = common.body_html;
  const descEnd = findDescriptionBoundary(bodyHtml);
  const description_html = bodyHtml.slice(0, descEnd).trim();
  return {
    description_html,
    description_text: htmlToText(description_html),
    outcomes:         parseOutcomes(bodyHtml),
  };
}

export type SpellOutcomesOutput = 'success' | 'error';

class SpellOutcomesNodeImpl extends ScalarNode<ScrapeState, SpellOutcomesOutput> {
  public readonly name = 'extract:spell-outcomes';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<'success' | 'error', SchemaObjectType> {
    return {
      // `success` — state.output merged with SpellOutcomesSlice
      success: { type: 'object' },
      // `error` — required metadata absent; no state mutation
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<SpellOutcomesOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const outcomes = extractSpellOutcomes(common);

    state.output = { ...state.output, ...outcomes };

    return NodeOutputBuilder.of('success');
  }
}
export const spellOutcomesNode = new SpellOutcomesNodeImpl();
