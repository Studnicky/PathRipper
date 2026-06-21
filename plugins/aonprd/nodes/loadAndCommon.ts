// Node: aonprd:load-and-common
// Loads cheerio from the raw HTML in state.page.html, runs the shared
// CommonExtraction pipeline, and stashes both the CheerioAPI handle and the
// CommonExtraction result as transient metadata keys for downstream nodes.
//
// `extractCommon` is strategy-driven. The singleton `loadAndCommonNode`
// exported below is wired with the AON strategy (`aonStrategy`). A non-AON
// plugin builds its own node via `makeLoadAndCommonNode(strategy)` and binds
// the same Layer-1 capabilities downstream.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import type { ScrapeState }  from '../../../src/state/ScrapeState.js';
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
 *     URL router, not this node, so DAGBuilder's explicit wiring does not
 *     declare page.html as a produced metadata key. The runtime still reads
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
): ScalarNode<ScrapeState, LoadAndCommonOutput> & {
} {
  class LoadAndCommonNodeImpl extends ScalarNode<ScrapeState, LoadAndCommonOutput> {
    public readonly name    = 'aonprd:load-and-common';
    public readonly outputs = CAPABILITY_OUTPUTS;

    public override get outputSchema(): Record<'success' | 'error', SchemaObjectType> {
      return {
        // `success` — stashes aonprdCheerio (and aonprdCommon + aonprdTarget for non-rule pages) in metadata; no state.output mutation
        success: { type: 'object' },
        // `error` — page.html was absent or extractCommon returned null; no state mutation
        error: { type: 'object' },
      };
    }

    protected override async executeOne(
      state:    ScrapeState,
      _context: NodeContextType,
    ): Promise<NodeOutputType<LoadAndCommonOutput>> {
      const html = state.page.html;
      if (html === undefined) return NodeOutputBuilder.of('error');

      const root = loadHtml(html);

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
        state.setMetadata('aonprdCheerio', root);
        return NodeOutputBuilder.of('success');
      }

      const common = extractCommon(root, state.page.url, strategy);
      if (common === null) return NodeOutputBuilder.of('error');

      // Resolve the target span (monster pages nest their statblock in a child span).
      const span = findContentSpan(root);
      const target = span !== null && span.find('span.monster-page').first().length > 0
        ? span.find('span.monster-page').first()
        : span;

      // Stash transient values on metadata — not serialized by snapshotData().
      state.setMetadata('aonprdCheerio', root);
      state.setMetadata('aonprdCommon',  common);
      state.setMetadata('aonprdTarget',  target);

      return NodeOutputBuilder.of('success');
    }
  }

  return new LoadAndCommonNodeImpl();
}

/**
 * `aonprd:load-and-common` — the AONPRD taxonomy's first capability after the
 * URL router. Singleton bound to the AON strategy; preserves
 * the pre-Wave-5 import surface so concept-level unit tests continue to
 * `import { loadAndCommonNode }` from this path.
 */
export const loadAndCommonNode = makeLoadAndCommonNode(aonStrategy);
