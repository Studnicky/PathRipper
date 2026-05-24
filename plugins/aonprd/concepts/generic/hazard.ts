// Hazard concept slices and extraction.

import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import {
  extractEntityId,
  stripStructuredKeys,
} from '../../common.js';
import {
  baseFrom,
  type SourceShape,
} from '../_helpers.js';
import {
  getHazardField,
  parseConditionStages,
  parseDisable,
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

export function extractHazardBase(c: CommonExtraction): HazardBaseSlice {
  const compRaw = (c.fields.find((f) => f.label.toLowerCase() === 'complexity')?.value_text ?? '').toLowerCase();
  const complexity: 'simple' | 'complex' | null =
    compRaw === 'simple'  ? 'simple' :
    compRaw === 'complex' ? 'complex' : null;
  const perceptionField = c.fields.find((f) => f.label.toLowerCase() === 'perception')?.value_text ?? null;
  const descField = c.fields.find((f) => f.label.toLowerCase() === 'description')?.value_text ?? null;
  return {
    url:             c.url,
    hazard_id:       extractEntityId(c.url),
    name:            c.title.name,
    level:           c.title.level,
    rarity:          c.traits.rarity,
    pfs:             c.title.pfs,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    traits:          c.traits.traits,
    trait_ids:       c.traits.trait_ids,
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:         c.sources,
    complexity,
    stealth:         parseHazardStealth(getHazardField(c, 'Stealth') ?? perceptionField),
    description_text: descField,
  };
}

export function extractHazardDefenses(c: CommonExtraction): HazardDefensesSlice {
  return { defenses: parseHazardDefenses(c) };
}

export function extractHazardRoutines(c: CommonExtraction): HazardRoutinesSlice {
  const { routines, disable, reset } = parseHazardRoutinesAndReset(c);
  return { routines, disable };
}

export function extractHazardReset(c: CommonExtraction): HazardResetSlice {
  const { reset } = parseHazardRoutinesAndReset(c);
  return { reset };
}

const HAZARD_CLAIMED_LABELS: ReadonlyArray<string> = [
  'Source', 'Complexity', 'Stealth', 'Description', 'Disable',
  'AC', 'Fort', 'Ref', 'Will', 'Immunities', 'Weaknesses', 'Resistances',
  'Hardness', 'HP', 'Trigger', 'Effect', 'Reset', 'Routine',
];

export function finalizeHazard(
  c:         CommonExtraction,
  base:      HazardBaseSlice,
  defenses:  HazardDefensesSlice,
  routines:  HazardRoutinesSlice,
  reset:     HazardResetSlice,
  $:         CheerioAPI,
): HazardOutput {
  // Collect component labels for stripping (e.g. "Main Hardness", "Door HP").
  const componentLabels: string[] = [];
  for (const comp of [...defenses.defenses.hardness, ...defenses.defenses.hp]) {
    if (comp.component !== 'main') {
      componentLabels.push(`${comp.component} Hardness`, `${comp.component} HP`);
    }
  }
  const routineLabels = routines.routines.map((r) => r.name);

  const baseShape = baseFrom(c, $);
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
    raw_fields:      stripStructuredKeys(c.field_map, [
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

export function extractHazard(c: CommonExtraction, $: CheerioAPI, _span: CheerioNode): HazardOutput {
  void _span;
  const base     = extractHazardBase(c);
  const defenses = extractHazardDefenses(c);
  const routines = extractHazardRoutines(c);
  const reset    = extractHazardReset(c);
  return finalizeHazard(c, base, defenses, routines, reset, $);
}
