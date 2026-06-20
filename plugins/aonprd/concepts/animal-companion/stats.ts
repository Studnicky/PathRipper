// Animal-companion stats extraction node.
import type { CommonExtraction } from '../../common.js';
import { asInt } from '../../common.js';
import type { AnimalCompanionStatsSlice } from './types.js';
import { findField, parseAbilities } from './helpers.js';

/** Extract size + abilities + HP + skill + senses + speed from harvested fields. */
export function extractAnimalCompanionStats(common: CommonExtraction): AnimalCompanionStatsSlice {
  const sizeEntry   = findField(common.fields, 'Size');
  const hpEntry     = findField(common.fields, 'Hit Points');
  const skillEntry  = findField(common.fields, 'Skill');
  const sensesEntry = findField(common.fields, 'Senses');
  const speedEntry  = findField(common.fields, 'Speed');
  return {
    size:       sizeEntry !== null ? sizeEntry.value_text : null,
    abilities:  parseAbilities(common.fields),
    hit_points: hpEntry !== null ? asInt(hpEntry.value_text) : null,
    skill:      skillEntry !== null ? skillEntry.value_text : null,
    senses:     sensesEntry !== null ? sensesEntry.value_text : null,
    speed:      speedEntry !== null ? speedEntry.value_text : null,
  };
}
