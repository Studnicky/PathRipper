/**
 * Ritual concept — per-slice extraction nodes.
 *
 * Nodes: extract:ritual-cast, extract:ritual-outcomes, extract:ritual-affliction,
 * extract:ritual-heightened, extract:ritual-meta
 */
import type { NodeInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import type { CommonExtraction } from '../../common.js';
import { CAPABILITY_OUTPUTS, getField, getFieldHtml } from '../../common.js';

import {
  parseCast,
  parseSavingThrow,
  parseDefense,
  parseOutcomes,
  parseAffliction,
  parseHeightenedWithFields,
  parseTraditions,
  parseRefList,
  parseFilteredRefList,
  parseLesson,
  parseSpoilerSource,
  findDescriptionBoundary,
} from './helpers.js';
import { htmlToText } from '../../common.js';
import type {
  RitualCastSlice,
  RitualOutcomesSlice,
  RitualAfflictionSlice,
  RitualHeightenedSlice,
  RitualMetaSlice,
} from './types.js';

/** Extract casting components, targeting, defenses, and duration/cost fields. */
export function extractSpellCast(c: CommonExtraction): RitualCastSlice {
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

export type RitualCastOutput = 'success' | 'error';

export const ritualCastNode: NodeInterface<ScrapeState, RitualCastOutput, RipperServices> = {
  name:    'extract:ritual-cast',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
  ): Promise<{ output: RitualCastOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const cast = extractSpellCast(c);

    state.output = { ...state.output, ...cast };

    return { output: 'success' };
  },
};

/** Extract description prose + save-tier outcomes from the body HTML. */
export function extractSpellOutcomes(c: CommonExtraction): RitualOutcomesSlice {
  const bodyHtml = c.body_html;
  const descEnd = findDescriptionBoundary(bodyHtml);
  const description_html = bodyHtml.slice(0, descEnd).trim();
  return {
    description_html,
    description_text: htmlToText(description_html),
    outcomes:         parseOutcomes(bodyHtml),
  };
}

export type RitualOutcomesOutput = 'success' | 'error';

export const ritualOutcomesNode: NodeInterface<ScrapeState, RitualOutcomesOutput, RipperServices> = {
  name:    'extract:ritual-outcomes',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
  ): Promise<{ output: RitualOutcomesOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const outcomes = extractSpellOutcomes(c);

    state.output = { ...state.output, ...outcomes };

    return { output: 'success' };
  },
};

/** Extract affliction stages + ritual-specific check fields. */
export function extractSpellAffliction(c: CommonExtraction): RitualAfflictionSlice {
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

export type RitualAfflictionOutput = 'success' | 'error';

export const ritualAfflictionNode: NodeInterface<ScrapeState, RitualAfflictionOutput, RipperServices> = {
  name:    'extract:ritual-affliction',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
  ): Promise<{ output: RitualAfflictionOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const affliction = extractSpellAffliction(c);

    state.output = { ...state.output, ...affliction };

    return { output: 'success' };
  },
};

/** Extract `<b>Heightened (LABEL)</b>` blocks in source order. */
export function extractSpellHeightened(c: CommonExtraction): RitualHeightenedSlice {
  return { heightened: parseHeightenedWithFields(c.body_html, c.fields) };
}

export type RitualHeightenedOutput = 'success' | 'error';

export const ritualHeightenedNode: NodeInterface<ScrapeState, RitualHeightenedOutput, RipperServices> = {
  name:    'extract:ritual-heightened',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
  ): Promise<{ output: RitualHeightenedOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const heightened = extractSpellHeightened(c);

    state.output = { ...state.output, ...heightened };

    return { output: 'success' };
  },
};

/** Extract spell-list metadata, ref lists, lesson, access, spoiler source. */
export function extractSpellMeta(c: CommonExtraction, $: CheerioAPI): RitualMetaSlice {
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

export type RitualMetaOutput = 'success' | 'error';

export const ritualMetaNode: NodeInterface<ScrapeState, RitualMetaOutput, RipperServices> = {
  name:    'extract:ritual-meta',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
  ): Promise<{ output: RitualMetaOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $ = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (c === undefined || $ === undefined) return { output: 'error' };

    const meta = extractSpellMeta(c, $);

    state.output = { ...state.output, ...meta };

    return { output: 'success' };
  },
};
