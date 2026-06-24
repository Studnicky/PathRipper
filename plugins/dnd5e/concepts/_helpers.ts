// Concept helpers — the typed setConceptOutput accessor.
//
// Finalize nodes assemble a `satisfies XxxOutput` literal and call
// `setConceptOutput` to merge it into `state.output`. The `satisfies` clause
// at the call site is the load-bearing compile-time check; this helper is a
// thin, monomorphic merge.
import type { ScrapeState } from '../../../src/state/ScrapeState.js';

/**
 * Merge a typed assembled output into `state.output`. The caller's `output`
 * literal carries a `satisfies XxxOutput` clause that fails `tsc` if any
 * required field is missing or any key is misspelled.
 */
export function setConceptOutput<TOutput extends object>(
  state:  ScrapeState,
  output: TOutput,
): void {
  const merged: Record<string, unknown> = state.output !== null
    ? { ...state.output, ...(output as Record<string, unknown>) }
    : { ...(output as Record<string, unknown>) };
  state.output = merged;
}
