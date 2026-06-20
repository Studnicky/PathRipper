/**
 * Spell concept — cast slice extraction.
 *
 * Extract casting components, targeting, defenses, and duration/cost fields.
 * Node: extract:spell-cast
 */
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { CommonExtraction } from '../../common.js';
import { CAPABILITY_OUTPUTS, getField } from '../../common.js';

import type { SpellCastSlice } from './types.js';
import { parseCast, parseSavingThrow, parseDefense } from './helpers.js';

/** Extract casting components, targeting, defenses, and duration/cost fields. */
export function extractSpellCast(common: CommonExtraction): SpellCastSlice {
  return {
    cast:         parseCast(common),
    trigger:      getField(common, 'Trigger'),
    range:        getField(common, 'Range'),
    area:         getField(common, 'Area'),
    targets:      getField(common, 'Targets', 'Target', 'Target(s)'),
    defense:      parseDefense(common),
    saving_throw: parseSavingThrow(common),
    duration:     getField(common, 'Duration'),
    cost:         getField(common, 'Cost'),
    requirements: getField(common, 'Requirements'),
  };
}

export type SpellCastOutput = 'success' | 'error';

class SpellCastNode extends ScalarNode<ScrapeState, SpellCastOutput> {
  public readonly name = 'extract:spell-cast';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<SpellCastOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const cast = extractSpellCast(common);

    state.output = { ...state.output, ...cast };

    return NodeOutputBuilder.of('success');
  }
}

export const spellCastNode = new SpellCastNode();
