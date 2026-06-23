// Taxonomic parse entry point.
//
// dandwiki URLs do not encode concept type, so this entry point classifies the
// page by CONTENT (`classifyDnd5ePage`) to pick the capability chain, then runs
// that chain. The `dnd5e:load-and-common` node at the head of the chain
// re-loads the HTML and stashes the metadata the finalize node reads. Loading
// HTML twice (once to classify, once in the node) is acceptable for the
// direct-call path and keeps the DAG-dispatch path identical.
import { Batch }              from '@studnicky/dagonizer';
import { NodeContextBuilder } from '@studnicky/dagonizer/entities';

import { ScrapeState } from '../../src/state/ScrapeState.js';
import { TAXONOMY }    from './taxonomy/dnd5e.js';
import { loadHtml, classifyDnd5ePage } from './common.js';

/** Metadata keys the dnd5e parse chain writes; cleared at end-of-parse. */
const DND5E_TRANSIENT_KEYS = ['dnd5eCheerio', 'dnd5eCommon', 'dnd5eTarget', 'dnd5eConceptId'] as const;

/**
 * Parse a dandwiki HTML page via the compiled dnd5e taxonomy. Classifies the
 * page by content, runs the matching concept's capability chain sequentially,
 * and returns `state.output`. Falls back to `{ url }` when no concept matches
 * and no fallback is configured.
 */
export async function parseDnd5eHtmlTaxonomic(html: string, url: string): Promise<Record<string, unknown>> {
  const state = new ScrapeState();
  state.page  = { targetId: 'dnd5e', title: '', url, html };
  state.output = {};

  const root             = loadHtml(html);
  const contentConceptId = classifyDnd5ePage(root);
  const conceptId        = contentConceptId !== '' ? contentConceptId : TAXONOMY.fallbackConceptId();
  if (conceptId === null) return { url };

  const chain = TAXONOMY.chainFor(conceptId);
  for (const node of chain) {
    await node.execute(
      Batch.of(state),
      NodeContextBuilder.of('dnd5e:parse:direct', 'dnd5e:parse:direct', new AbortController().signal, undefined),
    );
  }

  const output = state.output;
  state.clearTransientMetadata(DND5E_TRANSIENT_KEYS);
  return output ?? { url };
}
