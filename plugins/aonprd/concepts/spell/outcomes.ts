/**
 * Spell concept — outcomes slice extraction.
 *
 * Extract description prose + Critical Success / Success / Failure / Critical Failure blocks.
 * Node: extract:spell-outcomes
 */
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import type { CommonExtraction } from '../../common.js';
import { CAPABILITY_OUTPUTS, htmlToText } from '../../common.js';

import type { SpellOutcomesSlice } from './types.js';
import { findDescriptionBoundary, parseOutcomes } from './helpers.js';

/** Extract description prose + save-tier outcomes from the body HTML. */
export function extractSpellOutcomes(c: CommonExtraction): SpellOutcomesSlice {
  const bodyHtml = c.body_html;
  const descEnd = findDescriptionBoundary(bodyHtml);
  const description_html = bodyHtml.slice(0, descEnd).trim();
  return {
    description_html,
    description_text: htmlToText(description_html),
    outcomes:         parseOutcomes(bodyHtml),
  };
}

export type SpellOutcomesOutput = 'success' | 'error';

export const spellOutcomesNode: NodeInterface<ScrapeState, SpellOutcomesOutput, RipperServices> = {
  name:    'extract:spell-outcomes',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: SpellOutcomesOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const outcomes = extractSpellOutcomes(c);

    state.output = { ...state.output, ...outcomes };

    return { output: 'success' };
  },
};
