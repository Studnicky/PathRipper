// Node: aonprd:load-and-common
// Loads cheerio from the raw HTML in state.page.html, runs the shared
// CommonExtraction pipeline, and stashes both the CheerioAPI handle and the
// CommonExtraction result as transient metadata keys for downstream nodes.
//
// Wave 5 H15/H16: `extractCommon` is now strategy-driven. The singleton
// `loadAndCommonNode` exported below is wired with the AON strategy
// (`aonStrategy`). A non-AON plugin builds its own node via
// `makeLoadAndCommonNode(strategy)` and binds the same Layer-1 capabilities
// downstream.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';

import type { ScrapeState }  from '../../../src/state/ScrapeState.js';
import type { RipperServices }  from '../../../src/services/RipperServices.js';
import {
  CAPABILITY_OUTPUTS, loadHtml, extractCommon, findContentSpan, detectPageType } from '../common.js';
import type { CommonStrategy } from '../capabilities/strategy.js';
import { aonStrategy } from '../strategies/aon.js';

export type LoadAndCommonOutput = 'success' | 'error';

/**
 * Factory: build an `aonprd:load-and-common`-equivalent node bound to a
 * specific `CommonStrategy`. Plugins call this with their own strategy and
 * register the returned node as the root of their taxonomy chain.
 *
 * Inline contract:
 *   - `hardRequired: []` — `page.html` is external initial state, seeded into
 *     `ScrapeState.page.html` before the DAG runs. The DAG entrypoint is the
 *     URL router, not this node, so the `ContractRegistryValidator` would
 *     flag a `page.html` read as dangling. The runtime still reads
 *     `state.page.html` directly.
 *   - `produces: ['aonprdCheerio', 'aonprdCommon', 'aonprdTarget']` — the
 *     three metadata keys downstream Layer-1 capabilities consume.
 *
 * The node name is fixed at `aonprd:load-and-common` because:
 *   - The DAG annotations and many tests address it by name.
 *   - A future widening (separate node name per plugin) requires also
 *     re-naming the routing keys downstream; deferred until a second source
 *     plugin actually ships in production.
 */
export function makeLoadAndCommonNode(
  strategy: CommonStrategy,
): NodeInterface<ScrapeState, LoadAndCommonOutput, RipperServices> & {
  readonly contract: OperationContractFragment;
} {
  return {
    name:    'aonprd:load-and-common',
    outputs: CAPABILITY_OUTPUTS,
    contract: {
      hardRequired: [] as const,
      produces:     ['aonprdCheerio', 'aonprdCommon', 'aonprdTarget'] as const,
    } satisfies OperationContractFragment,

    async execute(
      state:    ScrapeState,
      _context: NodeContextInterface<RipperServices>,
    ): Promise<{ output: LoadAndCommonOutput }> {
      const html = state.page.html;
      if (html === undefined) return { output: 'error' };

      const $ = loadHtml(html);

      // Rule pages (Rules.aspx) use a div.rule container rather than the standard
      // <span> wrapper. extractCommon returns null for them, but we still want the
      // detect-type node to dispatch them correctly. Stash the CheerioAPI so that
      // extractRuleNode can access it; common and target are intentionally absent.
      //
      // This branch is AON-specific (rule pages are an AON-only concept); the
      // secondary plugin's strategy does not exercise it. The check is keyed on
      // `detectPageType` which is itself AON-shaped — that helper is scoped to
      // be lifted to the strategy in a future wave (see `extractCommon`).
      const pageType = detectPageType(state.page.url);
      if (pageType === 'rule') {
        state.setMetadata('aonprdCheerio', $);
        return { output: 'success' };
      }

      const common = extractCommon($, state.page.url, strategy);
      if (common === null) return { output: 'error' };

      // Resolve the target span (monster pages nest their statblock in a child span).
      const span = findContentSpan($);
      const target = span !== null && span.find('span.monster-page').first().length > 0
        ? span.find('span.monster-page').first()
        : span;

      // Stash transient values on metadata — not serialized by snapshotData().
      state.setMetadata('aonprdCheerio', $);
      state.setMetadata('aonprdCommon',  common);
      state.setMetadata('aonprdTarget',  target);

      return { output: 'success' };
    },
  };
}

/**
 * `aonprd:load-and-common` — the AONPRD taxonomy's first capability after the
 * URL router. Singleton bound to the AON strategy (Wave 5 H15/H16); preserves
 * the pre-Wave-5 import surface so concept-level unit tests continue to
 * `import { loadAndCommonNode }` from this path.
 */
export const loadAndCommonNode = makeLoadAndCommonNode(aonStrategy);
