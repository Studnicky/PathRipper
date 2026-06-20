// Familiar abilities extraction node.
import type { CommonExtraction } from '../../common.js';
import type { FamiliarAbilitiesSlice } from './types.js';
import { parseSubAbilities } from './helpers.js';

/** Extract sub-ability sections (`<h2 class="title">` blocks) from the body. */
export function extractFamiliarAbilities(common: CommonExtraction): FamiliarAbilitiesSlice {
  return { abilities: parseSubAbilities(common.body_html) };
}
