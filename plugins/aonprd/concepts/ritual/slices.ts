/**
 * Ritual concept — per-slice extraction nodes.
 *
 * Nodes: extract:ritual-cast, extract:ritual-outcomes, extract:ritual-affliction,
 * extract:ritual-heightened, extract:ritual-meta
 */
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
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
export function extractSpellCast(common: CommonExtraction): RitualCastSlice {
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

export type RitualCastOutput = 'success' | 'error';

class RitualCastNode extends ScalarNode<ScrapeState, RitualCastOutput> {
  public readonly name = 'extract:ritual-cast';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<RitualCastOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const cast = extractSpellCast(common);

    state.output = { ...state.output, ...cast };

    return NodeOutputBuilder.of('success');
  }
}

export const ritualCastNode = new RitualCastNode();

/** Extract description prose + save-tier outcomes from the body HTML. */
export function extractSpellOutcomes(common: CommonExtraction): RitualOutcomesSlice {
  const bodyHtml = common.body_html;
  const descEnd = findDescriptionBoundary(bodyHtml);
  const description_html = bodyHtml.slice(0, descEnd).trim();
  return {
    description_html,
    description_text: htmlToText(description_html),
    outcomes:         parseOutcomes(bodyHtml),
  };
}

export type RitualOutcomesOutput = 'success' | 'error';

class RitualOutcomesNode extends ScalarNode<ScrapeState, RitualOutcomesOutput> {
  public readonly name = 'extract:ritual-outcomes';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<RitualOutcomesOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const outcomes = extractSpellOutcomes(common);

    state.output = { ...state.output, ...outcomes };

    return NodeOutputBuilder.of('success');
  }
}

export const ritualOutcomesNode = new RitualOutcomesNode();

/** Extract affliction stages + ritual-specific check fields. */
export function extractSpellAffliction(common: CommonExtraction): RitualAfflictionSlice {
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

export type RitualAfflictionOutput = 'success' | 'error';

class RitualAfflictionNode extends ScalarNode<ScrapeState, RitualAfflictionOutput> {
  public readonly name = 'extract:ritual-affliction';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<RitualAfflictionOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const affliction = extractSpellAffliction(common);

    state.output = { ...state.output, ...affliction };

    return NodeOutputBuilder.of('success');
  }
}

export const ritualAfflictionNode = new RitualAfflictionNode();

/** Extract `<b>Heightened (LABEL)</b>` blocks in source order. */
export function extractSpellHeightened(common: CommonExtraction): RitualHeightenedSlice {
  return { heightened: parseHeightenedWithFields(common.body_html, common.fields) };
}

export type RitualHeightenedOutput = 'success' | 'error';

class RitualHeightenedNode extends ScalarNode<ScrapeState, RitualHeightenedOutput> {
  public readonly name = 'extract:ritual-heightened';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<RitualHeightenedOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const heightened = extractSpellHeightened(common);

    state.output = { ...state.output, ...heightened };

    return NodeOutputBuilder.of('success');
  }
}

export const ritualHeightenedNode = new RitualHeightenedNode();

/** Extract spell-list metadata, ref lists, lesson, access, spoiler source. */
export function extractSpellMeta(common: CommonExtraction, root: CheerioAPI): RitualMetaSlice {
  const bloodlines = parseRefList(getFieldHtml(common, 'Bloodline', 'Bloodlines'))
    .map((ritual) => ({ name: ritual.name, bloodline_id: ritual.id }));
  const cult = parseRefList(getFieldHtml(common, 'Cult', 'Cults'))
    .map((ritual) => ({ name: ritual.name, cult_id: ritual.id }));
  const domain = parseRefList(getFieldHtml(common, 'Domain', 'Domains'))
    .map((ritual) => ({ name: ritual.name, domain_id: ritual.id }));
  const deities = parseFilteredRefList(getFieldHtml(common, 'Deities', 'Deity'), /Deities\.aspx/i)
    .map((ritual) => ({ name: ritual.name, deity_id: ritual.id }));
  const mysteries = parseFilteredRefList(getFieldHtml(common, 'Mystery', 'Mysteries'), /Mysteries\.aspx/i)
    .map((ritual) => ({ name: ritual.name, mystery_id: ritual.id }));
  const patron_themes = parseFilteredRefList(getFieldHtml(common, 'Patron Theme', 'Patron Themes'), /Patrons\.aspx/i)
    .map((ritual) => ({ name: ritual.name, patron_id: ritual.id }));
  const catalysts = parseFilteredRefList(getFieldHtml(common, 'Catalysts', 'Catalyst'), /Equipment\.aspx/i)
    .map((ritual) => ({ name: ritual.name, equipment_id: ritual.id }));

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

export type RitualMetaOutput = 'success' | 'error';

class RitualMetaNode extends ScalarNode<ScrapeState, RitualMetaOutput> {
  public readonly name = 'extract:ritual-meta';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<RitualMetaOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root   = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (common === undefined || root === undefined) return NodeOutputBuilder.of('error');

    const meta = extractSpellMeta(common, root);

    state.output = { ...state.output, ...meta };

    return NodeOutputBuilder.of('success');
  }
}

export const ritualMetaNode = new RitualMetaNode();
