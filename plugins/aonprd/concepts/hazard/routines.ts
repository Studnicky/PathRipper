import type { CommonExtraction } from '../../common.js';
import type { HazardRoutinesSlice } from './types.js';
import { parseRoutines, parseDisable, getHazardField } from './helpers.js';

/** Extract routines slice (named routines + disable conditions). */
export function extractHazardRoutines(common: CommonExtraction): HazardRoutinesSlice {
  return {
    routines: parseRoutines(common),
    disable:  parseDisable(getHazardField(common, 'Disable')),
  };
}
