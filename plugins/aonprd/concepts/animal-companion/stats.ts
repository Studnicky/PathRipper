// Animal-companion stats extraction node.
import type { CommonExtraction } from '../../common.js';
import { asInt } from '../../common.js';
import type { AnimalCompanionStatsSlice } from './types.js';
import { findField, parseAbilities } from './helpers.js';

/** Extract size + abilities + HP + skill + senses + speed from harvested fields. */
export function extractAnimalCompanionStats(c: CommonExtraction): AnimalCompanionStatsSlice {
  const sizeEntry   = findField(c.fields, 'Size');
  const hpEntry     = findField(c.fields, 'Hit Points');
  const skillEntry  = findField(c.fields, 'Skill');
  const sensesEntry = findField(c.fields, 'Senses');
  const speedEntry  = findField(c.fields, 'Speed');
  return {
    size:       sizeEntry !== null ? sizeEntry.value_text : null,
    abilities:  parseAbilities(c.fields),
    hit_points: hpEntry !== null ? asInt(hpEntry.value_text) : null,
    skill:      skillEntry !== null ? skillEntry.value_text : null,
    senses:     sensesEntry !== null ? sensesEntry.value_text : null,
    speed:      speedEntry !== null ? speedEntry.value_text : null,
  };
}
