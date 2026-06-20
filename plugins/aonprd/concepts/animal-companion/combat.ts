// Animal-companion combat extraction node.
import type { CommonExtraction } from '../../common.js';
import { htmlToText } from '../../common.js';
import type { AnimalCompanionCombatSlice } from './types.js';
import { findField, parseStrikeValue, valueBeforeBlockBoundary } from './helpers.js';

/** Extract Melee/Ranged strikes + Support Benefit + Advanced Maneuver name. */
export function extractAnimalCompanionCombat(common: CommonExtraction): AnimalCompanionCombatSlice {
  const strikes = [];
  for (let index = 0; index < common.fields.length; index++) {
    const entry = common.fields[index]!;
    const lower = entry.label.toLowerCase();
    if (lower !== 'melee' && lower !== 'ranged') continue;
    // The Damage portion is the next adjacent field when present.
    let damage: string | null = null;
    const peek = common.fields[index + 1];
    if (peek !== undefined && peek.label.toLowerCase() === 'damage') {
      damage = peek.value_text;
    }
    strikes.push(parseStrikeValue(lower === 'melee' ? 'melee' : 'ranged', entry.value_html, damage));
  }
  const support  = findField(common.fields, 'Support Benefit');
  const maneuver = findField(common.fields, 'Advanced Maneuver');
  // Advanced Maneuver value can pick up the trailing <h3> sub-block heading
  // because the field harvester stops only at `<b>` boundaries. Re-flatten
  // just the HTML portion before any heading/hr token.
  const maneuverName = maneuver !== null
    ? htmlToText(valueBeforeBlockBoundary(maneuver.value_html))
    : null;
  return {
    strikes,
    support_benefit:   support !== null ? support.value_text : null,
    advanced_maneuver: maneuverName !== null && maneuverName !== '' ? maneuverName : null,
  };
}
