/**
 * Spell concept — meta slice extraction.
 *
 * Extract traditions, spell-list, bloodlines, cults, domains, deities, mysteries,
 * patron themes, catalysts, lesson, access, spoiler source.
 * Node: extract:spell-meta
 */
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { OperationContractFragmentType } from '@studnicky/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { CommonExtraction } from '../../common.js';
import { CAPABILITY_OUTPUTS, getField, getFieldHtml } from '../../common.js';

import type { SpellMetaSlice } from './types.js';
import {
  parseTraditions,
  parseRefList,
  parseFilteredRefList,
  parseLesson,
  parseSpoilerSource,
} from './helpers.js';

/** Extract spell-list metadata, ref lists, lesson, access, spoiler source. */
export function extractSpellMeta(common: CommonExtraction, root: CheerioAPI): SpellMetaSlice {
  const bloodlines = parseRefList(getFieldHtml(common, 'Bloodline', 'Bloodlines'))
    .map((ref) => ({ name: ref.name, bloodline_id: ref.id }));
  const cult = parseRefList(getFieldHtml(common, 'Cult', 'Cults'))
    .map((ref) => ({ name: ref.name, cult_id: ref.id }));
  const domain = parseRefList(getFieldHtml(common, 'Domain', 'Domains'))
    .map((ref) => ({ name: ref.name, domain_id: ref.id }));
  const deities = parseFilteredRefList(getFieldHtml(common, 'Deities', 'Deity'), /Deities\.aspx/i)
    .map((ref) => ({ name: ref.name, deity_id: ref.id }));
  const mysteries = parseFilteredRefList(getFieldHtml(common, 'Mystery', 'Mysteries'), /Mysteries\.aspx/i)
    .map((ref) => ({ name: ref.name, mystery_id: ref.id }));
  const patron_themes = parseFilteredRefList(getFieldHtml(common, 'Patron Theme', 'Patron Themes'), /Patrons\.aspx/i)
    .map((ref) => ({ name: ref.name, patron_id: ref.id }));
  const catalysts = parseFilteredRefList(getFieldHtml(common, 'Catalysts', 'Catalyst'), /Equipment\.aspx/i)
    .map((ref) => ({ name: ref.name, equipment_id: ref.id }));

  return {
    traditions:     parseTraditions(common),
    spell_list:     getField(common, 'Spell List'),
    bloodlines,
    cult,
    domain,
    deities,
    mysteries,
    patron_themes,
    catalysts,
    lesson:         parseLesson(common),
    access:         getField(common, 'Access'),
    spoiler_source: parseSpoilerSource(root),
  };
}

export type SpellMetaOutput = 'success' | 'error';

class SpellMetaNode extends ScalarNode<ScrapeState, SpellMetaOutput> {
  public readonly name = 'extract:spell-meta';
  public readonly outputs = CAPABILITY_OUTPUTS;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon', 'aonprdCheerio'] as const,
    produces:     [] as const,
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<SpellMetaOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root   = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (common === undefined || root === undefined) return NodeOutputBuilder.of('error');

    const meta = extractSpellMeta(common, root);

    state.output = { ...state.output, ...meta };

    return NodeOutputBuilder.of('success');
  }
}

export const spellMetaNode = new SpellMetaNode();
