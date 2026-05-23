/**
 * Spell concept — meta slice extraction.
 *
 * Extract traditions, spell-list, bloodlines, cults, domains, deities, mysteries,
 * patron themes, catalysts, lesson, access, spoiler source.
 * Node: extract:spell-meta
 */
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
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
export function extractSpellMeta(c: CommonExtraction, $: CheerioAPI): SpellMetaSlice {
  const bloodlines = parseRefList(getFieldHtml(c, 'Bloodline', 'Bloodlines'))
    .map((r) => ({ name: r.name, bloodline_id: r.id }));
  const cult = parseRefList(getFieldHtml(c, 'Cult', 'Cults'))
    .map((r) => ({ name: r.name, cult_id: r.id }));
  const domain = parseRefList(getFieldHtml(c, 'Domain', 'Domains'))
    .map((r) => ({ name: r.name, domain_id: r.id }));
  const deities = parseFilteredRefList(getFieldHtml(c, 'Deities', 'Deity'), /Deities\.aspx/i)
    .map((r) => ({ name: r.name, deity_id: r.id }));
  const mysteries = parseFilteredRefList(getFieldHtml(c, 'Mystery', 'Mysteries'), /Mysteries\.aspx/i)
    .map((r) => ({ name: r.name, mystery_id: r.id }));
  const patron_themes = parseFilteredRefList(getFieldHtml(c, 'Patron Theme', 'Patron Themes'), /Patrons\.aspx/i)
    .map((r) => ({ name: r.name, patron_id: r.id }));
  const catalysts = parseFilteredRefList(getFieldHtml(c, 'Catalysts', 'Catalyst'), /Equipment\.aspx/i)
    .map((r) => ({ name: r.name, equipment_id: r.id }));

  return {
    traditions:     parseTraditions(c),
    spell_list:     getField(c, 'Spell List'),
    bloodlines,
    cult,
    domain,
    deities,
    mysteries,
    patron_themes,
    catalysts,
    lesson:         parseLesson(c),
    access:         getField(c, 'Access'),
    spoiler_source: parseSpoilerSource($),
  };
}

export type SpellMetaOutput = 'success' | 'error';

export const spellMetaNode: NodeInterface<ScrapeState, SpellMetaOutput, RipperServices> = {
  name:    'extract:spell-meta',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: SpellMetaOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $ = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (c === undefined || $ === undefined) return { output: 'error' };

    const meta = extractSpellMeta(c, $);

    state.output = { ...state.output, ...meta };

    return { output: 'success' };
  },
};
