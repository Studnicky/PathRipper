/**
 * Spell concept — cast slice extraction.
 *
 * Extract casting components, targeting, defenses, and duration/cost fields.
 * Node: extract:spell-cast
 */
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import type { CommonExtraction } from '../../common.js';
import { CAPABILITY_OUTPUTS, getField } from '../../common.js';

import type { SpellCastSlice } from './types.js';
import { parseCast, parseSavingThrow, parseDefense } from './helpers.js';

/** Extract casting components, targeting, defenses, and duration/cost fields. */
export function extractSpellCast(c: CommonExtraction): SpellCastSlice {
  return {
    cast:         parseCast(c),
    trigger:      getField(c, 'Trigger'),
    range:        getField(c, 'Range'),
    area:         getField(c, 'Area'),
    targets:      getField(c, 'Targets', 'Target', 'Target(s)'),
    defense:      parseDefense(c),
    saving_throw: parseSavingThrow(c),
    duration:     getField(c, 'Duration'),
    cost:         getField(c, 'Cost'),
    requirements: getField(c, 'Requirements'),
  };
}

export type SpellCastOutput = 'success' | 'error';

export const spellCastNode: NodeInterface<ScrapeState, SpellCastOutput, RipperServices> = {
  name:    'extract:spell-cast',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: SpellCastOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const cast = extractSpellCast(c);

    state.output = { ...state.output, ...cast };

    return { output: 'success' };
  },
};
