// Node: dnd5e:load-and-common
//
// Loads cheerio from the raw HTML in `state.page.html`, runs the shared
// `extractCommonDnd5e` projection, classifies the page by content, and stashes
// the CheerioAPI handle, the common projection, the content target, and the
// content-classified concept ID as transient metadata for downstream nodes.
//
// Unlike the URL-routed aonprd plugin, dandwiki URLs do not encode concept
// type — so classification happens HERE, by content, and the result is stashed
// under `dnd5eConceptId` for the taxonomy router (DAG mode) and finalize nodes.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import type { ScrapeState } from '../../../src/state/ScrapeState.js';
import { loadHtml, getContentRoot, extractCommonDnd5e, classifyDnd5ePage } from '../common.js';

export type LoadAndCommonOutput = 'success' | 'error';

export const DND5E_CAPABILITY_OUTPUTS = ['success', 'error'] as const satisfies readonly LoadAndCommonOutput[];

/**
 * Build the `dnd5e:load-and-common` node. Loads HTML, extracts the common
 * projection, classifies the page, and stashes:
 *   - `dnd5eCheerio`   — the CheerioAPI handle
 *   - `dnd5eCommon`    — the {@link Dnd5eCommon} projection
 *   - `dnd5eTarget`    — the content root (`div.mw-parser-output`)
 *   - `dnd5eConceptId` — the content-classified concept ID ('spell' | 'generic')
 *
 * Returns `'error'` when `state.page.html` is undefined; `'success'` otherwise.
 */
export function makeLoadAndCommonNode(): ScalarNode<ScrapeState, LoadAndCommonOutput> {
  class LoadAndCommonNodeImpl extends ScalarNode<ScrapeState, LoadAndCommonOutput> {
    public readonly name    = 'dnd5e:load-and-common';
    public readonly outputs = DND5E_CAPABILITY_OUTPUTS;

    public override get outputSchema(): Record<LoadAndCommonOutput, SchemaObjectType> {
      return {
        success: { type: 'object' },
        error:   { type: 'object' },
      };
    }

    protected override async executeOne(
      state:    ScrapeState,
      _context: NodeContextType,
    ): Promise<NodeOutputType<LoadAndCommonOutput>> {
      const html = state.page.html;
      if (html === undefined) return NodeOutputBuilder.of('error');

      const root      = loadHtml(html);
      const target    = getContentRoot(root);
      const common    = extractCommonDnd5e(root, state.page.url);
      const conceptId = classifyDnd5ePage(root);

      state.setMetadata('dnd5eCheerio',   root);
      state.setMetadata('dnd5eCommon',    common);
      state.setMetadata('dnd5eTarget',    target);
      state.setMetadata('dnd5eConceptId', conceptId);

      return NodeOutputBuilder.of('success');
    }
  }

  return new LoadAndCommonNodeImpl();
}

/** `dnd5e:load-and-common` — the dnd5e taxonomy's first capability after the URL router. */
export const loadAndCommonNode = makeLoadAndCommonNode();
