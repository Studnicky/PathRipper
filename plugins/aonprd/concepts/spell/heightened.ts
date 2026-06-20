/**
 * Spell concept — heightened slice extraction.
 *
 * Extract Heightened (Xth) / Heightened (+N) variant blocks in source order.
 * Node: extract:spell-heightened
 */
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { OperationContractFragmentType } from '@studnicky/dagonizer/contracts';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { CommonExtraction } from '../../common.js';
import { CAPABILITY_OUTPUTS, getAllFields } from '../../common.js';

import type { SpellHeightenedSlice } from './types.js';
import { parseHeightenedWithFields } from './helpers.js';

/** Extract `<b>Heightened (LABEL)</b>` blocks in source order. */
export function extractSpellHeightened(common: CommonExtraction): SpellHeightenedSlice {
  // Extra Heightened header occurrences are absorbed by parseHeightenedWithFields.
  void getAllFields;
  return { heightened: parseHeightenedWithFields(common.body_html, common.fields) };
}

export type SpellHeightenedOutput = 'success' | 'error';

class SpellHeightenedNode extends ScalarNode<ScrapeState, SpellHeightenedOutput> {
  public readonly name = 'extract:spell-heightened';
  public readonly outputs = CAPABILITY_OUTPUTS;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<SpellHeightenedOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const heightened = extractSpellHeightened(common);

    state.output = { ...state.output, ...heightened };

    return NodeOutputBuilder.of('success');
  }
}

export const spellHeightenedNode = new SpellHeightenedNode();
