// extract:deity-relationships slice — deity cross-references.

import type { CommonExtraction } from '../../common.js';
import { extractEntityId } from '../../common.js';
import { parseDeityRelationships } from './helpers.js';
import type { DeityRelationshipsSlice } from './types.js';

export function extractDeityRelationships(common: CommonExtraction): DeityRelationshipsSlice {
  return { deity_relationships: parseDeityRelationships(common, extractEntityId) };
}
