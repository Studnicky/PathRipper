/**
 * Ability scores capability — parse Str/Dex/Con/Int/Wis/Cha modifier block.
 *
 * Exports: AbilityScores interface, parseAbilityScores function.
 */
import type { AbilityScore } from '../concepts/monster/types.js';
import { ABILITY_NAMES } from '../concepts/monster/types.js';
import { asInt, getField, getAllFields } from '../common.js';
import type { CommonExtraction } from '../common.js';

export type AbilityScores = Record<AbilityScore, number | null>;

/**
 * Parse six-stat ability scores row.
 * Values may share one harvested label with the rest embedded.
 */
export function parseAbilityScores(common: CommonExtraction): AbilityScores {
  const out: AbilityScores = {
    str: null, dex: null, con: null, int: null, wis: null, cha: null,
  };
  for (const name of ABILITY_NAMES) {
    const value = getField(common, name.charAt(0).toUpperCase() + name.slice(1));
    if (value !== null) out[name] = asInt(value);
  }
  for (const field of getAllFields(common, 'Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha')) {
    const regex = /<b>\s*(Str|Dex|Con|Int|Wis|Cha)\s*<\/b>\s*([+-]?\d+)/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(field.value_html)) !== null) {
      const key = match[1]!.toLowerCase() as AbilityScore;
      const num = parseInt(match[2]!, 10);
      if (Number.isFinite(num)) out[key] = num;
    }
  }
  return out;
}
