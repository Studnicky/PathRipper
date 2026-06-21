import type { CommonExtraction } from '../../common.js';
import type { HazardResetSlice } from './types.js';
import { getHazardField } from './helpers.js';

/** Extract reset slice (reset conditions and special exit triggers). */
export function extractHazardReset(common: CommonExtraction): HazardResetSlice {
  return { reset: getHazardField(common, 'Reset') };
}
