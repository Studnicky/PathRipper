import type { CommonExtraction } from '../../common.js';
import { asInt, splitTopLevel } from '../../common.js';
import type { HazardDefensesSlice } from './types.js';
import {
  parseHazardComponents,
  parseWeaknesses,
  parseResistances,
  getHazardField,
} from './helpers.js';

/** Extract defenses slice (AC, saves, hardness, HP, immunities, weaknesses, resistances). */
export function extractHazardDefenses(common: CommonExtraction): HazardDefensesSlice {
  return {
    defenses: {
      ac:    asInt(getHazardField(common, 'AC')),
      saves: {
        fort: asInt(getHazardField(common, 'Fort')),
        ref:  asInt(getHazardField(common, 'Ref')),
        will: asInt(getHazardField(common, 'Will')),
      },
      hardness:    parseHazardComponents(common, 'Hardness'),
      hp:          parseHazardComponents(common, 'HP'),
      immunities:  splitTopLevel(getHazardField(common, 'Immunities') ?? '', ',').filter(Boolean),
      weaknesses:  parseWeaknesses(getHazardField(common, 'Weaknesses')),
      resistances: parseResistances(getHazardField(common, 'Resistances')),
    },
  };
}
