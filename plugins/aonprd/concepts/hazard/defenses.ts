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
export function extractHazardDefenses(c: CommonExtraction): HazardDefensesSlice {
  return {
    defenses: {
      ac:    asInt(getHazardField(c, 'AC')),
      saves: {
        fort: asInt(getHazardField(c, 'Fort')),
        ref:  asInt(getHazardField(c, 'Ref')),
        will: asInt(getHazardField(c, 'Will')),
      },
      hardness:    parseHazardComponents(c, 'Hardness'),
      hp:          parseHazardComponents(c, 'HP'),
      immunities:  splitTopLevel(getHazardField(c, 'Immunities') ?? '', ',').filter(Boolean),
      weaknesses:  parseWeaknesses(getHazardField(c, 'Weaknesses')),
      resistances: parseResistances(getHazardField(c, 'Resistances')),
    },
  };
}
