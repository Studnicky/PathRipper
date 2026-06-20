// extract:class-progression slice.

import type { CommonExtraction } from '../../common.js';
import { getField } from '../../common.js';
import { parseClassFeaturesProgression } from './helpers.js';
import type { ClassProgressionSlice } from './types.js';

export function extractClassProgression(common: CommonExtraction): ClassProgressionSlice {
  const raw = getField(common, 'Class Features');
  return { progression: parseClassFeaturesProgression(raw) };
}
