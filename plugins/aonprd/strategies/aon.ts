// AON-specific Layer-1 strategy.
//
// Binds the framework-level `CommonStrategy` interface to the AON markup
// patterns. The strategy's behaviour is identical to the pre-Wave-5
// `extractCommon` path — `extractSources` consumes the `<b>Source</b>` +
// `Sources.aspx?ID=` AON pattern; `harvestSections` walks the `h2.title` /
// `h3.title` AON headings.
//
// A non-AON plugin (bulbapedia, torreya, the `_test_secondary` stub) supplies
// its own `CommonStrategy` against the same interface.
import { extractSources as aonExtractSources, harvestSections as aonHarvestSections } from '../common.js';
import type { CommonStrategy } from '../../../src/types/ExtractionStrategy.js';

/**
 * AON Layer-1 strategy.
 *
 * Wraps the AON-specific helpers in `common.ts` (`extractSources` /
 * `harvestSections`) in the framework-level `CommonStrategy` interface so the
 * same Layer-1 capability binary works for AON pages and any future source.
 */
export const aonStrategy: CommonStrategy = {
  sourceRef: {
    extractSources(target) {
      return aonExtractSources(target);
    },
  },
  sectionWalker: {
    harvestSections(root, target) {
      return aonHarvestSections(root, target);
    },
  },
};
