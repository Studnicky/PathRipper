/**
 * Spell concept — affliction slice extraction.
 *
 * Extract inline affliction stages + ritual-specific check fields.
 * Node: extract:spell-affliction
 */
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { CommonExtraction } from '../../common.js';
import { CAPABILITY_OUTPUTS, getField } from '../../common.js';

import type { SpellAfflictionSlice } from './types.js';
import { parseAffliction } from './helpers.js';

/** Extract affliction stages + ritual-specific check fields. */
export function extractSpellAffliction(common: CommonExtraction): SpellAfflictionSlice {
  const ritual_secondary_casters_raw = getField(common, 'Secondary Casters');
  const ritual_secondary_casters = ritual_secondary_casters_raw !== null
    ? (parseInt(ritual_secondary_casters_raw.trim(), 10) || null)
    : null;
  return {
    affliction:               parseAffliction(common.body_html),
    ritual_primary_check:     getField(common, 'Primary Check'),
    ritual_secondary_casters,
    ritual_secondary_checks:  getField(common, 'Secondary Checks'),
  };
}

export type SpellAfflictionOutput = 'success' | 'error';

class SpellAfflictionNodeImpl extends ScalarNode<ScrapeState, SpellAfflictionOutput> {
  public readonly name    = 'extract:spell-affliction';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<SpellAfflictionOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const affliction = extractSpellAffliction(common);

    state.output = { ...state.output, ...affliction };

    return NodeOutputBuilder.of('success');
  }
}
export const spellAfflictionNode = new SpellAfflictionNodeImpl();
