/**
 * Spell concept — heightened slice extraction.
 *
 * Extract Heightened (Xth) / Heightened (+N) variant blocks in source order.
 * Node: extract:spell-heightened
 */
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import type { CommonExtraction } from '../../common.js';
import { CAPABILITY_OUTPUTS, getAllFields } from '../../common.js';

import type { SpellHeightenedSlice } from './types.js';
import { parseHeightenedWithFields } from './helpers.js';

/** Extract `<b>Heightened (LABEL)</b>` blocks in source order. */
export function extractSpellHeightened(c: CommonExtraction): SpellHeightenedSlice {
  // Extra Heightened header occurrences are absorbed by parseHeightenedWithFields.
  void getAllFields;
  return { heightened: parseHeightenedWithFields(c.body_html, c.fields) };
}

export type SpellHeightenedOutput = 'success' | 'error';

export const spellHeightenedNode: NodeInterface<ScrapeState, SpellHeightenedOutput, RipperServices> = {
  name:    'extract:spell-heightened',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: SpellHeightenedOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const heightened = extractSpellHeightened(c);

    state.output = { ...state.output, ...heightened };

    return { output: 'success' };
  },
};
