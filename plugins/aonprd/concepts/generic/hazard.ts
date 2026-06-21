// Hazard concept slices and extraction.

import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import {
  extractEntityId,
  stripStructuredKeys,
} from '../../common.js';
import {
  baseFrom,
} from '../_helpers.js';
import {
  getHazardField,
  parseHazardDefenses,
  parseHazardRoutinesAndReset,
  parseHazardStealth,
} from './helpers.js';
import type {
  HazardOutput,
  HazardBaseSlice,
  HazardDefensesSlice,
  HazardRoutinesSlice,
  HazardResetSlice,
} from './types.js';

export function extractHazardBase(common: CommonExtraction): HazardBaseSlice {
  const compRaw = (common.fields.find((field) => field.label.toLowerCase() === 'complexity')?.value_text ?? '').toLowerCase();
  const complexity: 'simple' | 'complex' | null =
    compRaw === 'simple'  ? 'simple' :
    compRaw === 'complex' ? 'complex' : null;
  const perceptionField = common.fields.find((field) => field.label.toLowerCase() === 'perception')?.value_text ?? null;
  const descField = common.fields.find((field) => field.label.toLowerCase() === 'description')?.value_text ?? null;
  return {
    url:             common.url,
    hazard_id:       extractEntityId(common.url),
    name:            common.title.name,
    level:           common.title.level,
    rarity:          common.traits.rarity,
    pfs:             common.title.pfs,
    legacy:          common.title.legacy,
    alt_edition_url: common.title.alt_edition_url,
    traits:          common.traits.traits,
    trait_ids:       common.traits.trait_ids,
    source:          { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:         common.sources,
    complexity,
    stealth:         parseHazardStealth(getHazardField(common, 'Stealth') ?? perceptionField),
    description_text: descField,
  };
}

export function extractHazardDefenses(common: CommonExtraction): HazardDefensesSlice {
  return { defenses: parseHazardDefenses(common) };
}

export function extractHazardRoutines(common: CommonExtraction): HazardRoutinesSlice {
  const { routines, disable } = parseHazardRoutinesAndReset(common);
  return { routines, disable };
}

export function extractHazardReset(common: CommonExtraction): HazardResetSlice {
  const { reset } = parseHazardRoutinesAndReset(common);
  return { reset };
}

const HAZARD_CLAIMED_LABELS: ReadonlyArray<string> = [
  'Source', 'Complexity', 'Stealth', 'Description', 'Disable',
  'AC', 'Fort', 'Ref', 'Will', 'Immunities', 'Weaknesses', 'Resistances',
  'Hardness', 'HP', 'Trigger', 'Effect', 'Reset', 'Routine',
];

export function finalizeHazard(
  common:    CommonExtraction,
  base:      HazardBaseSlice,
  defenses:  HazardDefensesSlice,
  routines:  HazardRoutinesSlice,
  reset:     HazardResetSlice,
  root:      CheerioAPI,
): HazardOutput {
  // Collect component labels for stripping (e.g. "Main Hardness", "Door HP").
  const componentLabels: string[] = [];
  for (const comp of [...defenses.defenses.hardness, ...defenses.defenses.hp]) {
    if (comp.component !== 'main') {
      componentLabels.push(`${comp.component} Hardness`, `${comp.component} HP`);
    }
  }
  const routineLabels = routines.routines.map((routine) => routine.name);

  const baseShape = baseFrom(common, root);
  return {
    ...baseShape,
    url:             base.url,
    hazard_id:       base.hazard_id,
    name:            base.name,
    rarity:          base.rarity,
    pfs:             base.pfs,
    legacy:          base.legacy,
    alt_edition_url: base.alt_edition_url,
    traits:          base.traits,
    trait_ids:       base.trait_ids,
    source:          base.source,
    sources:         base.sources,
    raw_fields:      stripStructuredKeys(common.field_map, [
      ...HAZARD_CLAIMED_LABELS,
      ...componentLabels,
      ...routineLabels,
    ]),
    level:           base.level,
    complexity:      base.complexity,
    stealth:         base.stealth,
    description_text: base.description_text,
    disable:         routines.disable,
    defenses:        defenses.defenses,
    routines:        routines.routines,
    reset:           reset.reset,
  } satisfies HazardOutput;
}

export function extractHazard(common: CommonExtraction, root: CheerioAPI, _span: CheerioNode): HazardOutput {
  void _span;
  const base     = extractHazardBase(common);
  const defenses = extractHazardDefenses(common);
  const routines = extractHazardRoutines(common);
  const reset    = extractHazardReset(common);
  return finalizeHazard(common, base, defenses, routines, reset, root);
}
