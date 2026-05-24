import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction, Section } from '../../common.js';
import { stripStructuredKeys, filterLegacySections } from '../../common.js';
import { baseFrom, setConceptOutput } from '../_helpers.js';
import type {
  HazardOutput,
  HazardBaseSlice,
  HazardDefensesSlice,
  HazardRoutinesSlice,
  HazardResetSlice,
} from './types.js';

/** AON labels every hazard-slice helper has lifted into structured fields. */
const HAZARD_CLAIMED_LABELS: ReadonlyArray<string> = [
  'Source', 'Complexity', 'Stealth', 'Description', 'Disable',
  'AC', 'Fort', 'Ref', 'Will', 'Immunities', 'Weaknesses', 'Resistances',
  'Hardness', 'HP', 'Trigger', 'Effect', 'Reset', 'Routine',
];

/**
 * Assemble the final HazardOutput from per-slice results.
 *
 * Computes `raw_fields` by stripping every label claimed by upstream slices
 * (HAZARD_CLAIMED_LABELS), every Hardness/HP component label, and every routine
 * name (claimed by the routines slice).
 */
export function finalizeHazard(
  c:         CommonExtraction,
  base:      HazardBaseSlice,
  defenses:  HazardDefensesSlice,
  routines:  HazardRoutinesSlice,
  reset:     HazardResetSlice,
  $:         CheerioAPI,
): HazardOutput {
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

export function finalizeHazardWithSections(
  c:         CommonExtraction,
  base:      HazardBaseSlice,
  defenses:  HazardDefensesSlice,
  routines:  HazardRoutinesSlice,
  reset:     HazardResetSlice,
  sections:  Section[],
  $:         CheerioAPI,
): HazardOutput {
  const output = finalizeHazard(c, base, defenses, routines, reset, $);
  return {
    ...output,
    sections: filterLegacySections(sections),
  };
}
