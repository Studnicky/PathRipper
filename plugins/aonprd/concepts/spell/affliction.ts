/**
 * Spell concept — affliction slice extraction.
 *
 * Extract inline affliction stages + ritual-specific check fields.
 * Node: extract:spell-affliction
 */
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import type { CommonExtraction } from '../../common.js';
import { CAPABILITY_OUTPUTS, getField } from '../../common.js';

import type { SpellAfflictionSlice } from './types.js';
import { parseAffliction } from './helpers.js';

/** Extract affliction stages + ritual-specific check fields. */
export function extractSpellAffliction(c: CommonExtraction): SpellAfflictionSlice {
  const ritual_secondary_casters_raw = getField(c, 'Secondary Casters');
  const ritual_secondary_casters = ritual_secondary_casters_raw !== null
    ? (parseInt(ritual_secondary_casters_raw.trim(), 10) || null)
    : null;
  return {
    affliction:               parseAffliction(c.body_html),
    ritual_primary_check:     getField(c, 'Primary Check'),
    ritual_secondary_casters,
    ritual_secondary_checks:  getField(c, 'Secondary Checks'),
  };
}

export type SpellAfflictionOutput = 'success' | 'error';

export const spellAfflictionNode: NodeInterface<ScrapeState, SpellAfflictionOutput, RipperServices> = {
  name:    'extract:spell-affliction',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: SpellAfflictionOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const affliction = extractSpellAffliction(c);

    state.output = { ...state.output, ...affliction };

    return { output: 'success' };
  },
};
