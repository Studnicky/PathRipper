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
export function parseAbilityScores(c: CommonExtraction): AbilityScores {
  const out: AbilityScores = {
    str: null, dex: null, con: null, int: null, wis: null, cha: null,
  };
  for (const name of ABILITY_NAMES) {
    const v = getField(c, name.charAt(0).toUpperCase() + name.slice(1));
    if (v !== null) out[name] = asInt(v);
  }
  for (const f of getAllFields(c, 'Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha')) {
    const re = /<b>\s*(Str|Dex|Con|Int|Wis|Cha)\s*<\/b>\s*([+-]?\d+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.value_html)) !== null) {
      const key = m[1]!.toLowerCase() as AbilityScore;
      const n = parseInt(m[2]!, 10);
      if (Number.isFinite(n)) out[key] = n;
    }
  }
  return out;
}
