// Animal-companion meta extraction node.
import type { CommonExtraction } from '../../common.js';
import type { AnimalCompanionMetaSlice } from './types.js';

/** Meta marker — body/sections/links/meta attach during finalize. */
export function extractAnimalCompanionMeta(_common: CommonExtraction): AnimalCompanionMetaSlice {
  return { __animal_companion_meta_marked: true };
}
