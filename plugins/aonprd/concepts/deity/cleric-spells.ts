// extract:deity-cleric-spells slice — cleric spells rank list + intercessions.

import type { CommonExtraction } from '../../common.js';
import {
  harvestLinkedBoldLabelsHtml,
  findSectionBody,
  parseClericSpells,
  parseIntercessions,
} from './helpers.js';
import type { DeityClericSpellsSlice } from './types.js';

export function extractDeityClericSpells(common: CommonExtraction): DeityClericSpellsSlice {
  const body = findSectionBody(common, 'Devotee Benefits');
  const map  = harvestLinkedBoldLabelsHtml(body);
  return {
    cleric_spells: parseClericSpells(map.get('cleric spells') ?? null),
    intercessions: parseIntercessions(common),
  };
}
