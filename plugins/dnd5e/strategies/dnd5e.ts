// dnd5e CommonStrategy binding.
//
// dandwiki pages carry no structured source citations (every page is published
// under the single "5e SRD" collection, surfaced via `Dnd5eCommon.source`), so
// `extractSources` is a no-op. `harvestSections` adapts the plugin's
// `extractSections(root)` to the framework's `($, target)` signature.
import type { CheerioAPI } from 'cheerio';

import type { CommonStrategy, CheerioTarget, Section, SourceRef } from '../../../src/types/ExtractionStrategy.js';
import { extractSections } from '../common.js';

export const dnd5eStrategy: CommonStrategy = {
  sourceRef: {
    extractSources(_target: CheerioTarget, _root: CheerioAPI): SourceRef[] {
      return [];
    },
  },
  sectionWalker: {
    harvestSections(root: CheerioAPI, _target: CheerioTarget): Section[] {
      return extractSections(root);
    },
  },
};
