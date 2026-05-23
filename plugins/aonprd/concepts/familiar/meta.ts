// Familiar meta extraction node.
import type { CommonExtraction } from '../../common.js';
import type { FamiliarMetaSlice } from './types.js';

/** Meta slice marker — body / links / meta are attached by finalize. */
export function extractFamiliarMeta(_c: CommonExtraction): FamiliarMetaSlice {
  void _c;
  return { _meta_marker: true };
}
