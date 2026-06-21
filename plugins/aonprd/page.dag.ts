// Plugin DAG: aonprd:page.
//
// Per-page chain: fetch HTML, parse via the aonprd:parse sub-DAG, write JSON.
import { DAGBuilder } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';

import type { ScrapeState } from '../../src/state/ScrapeState.js';
import { HtmlFetchNode, JsonWriteNode } from '../../src/nodes/index.js';

const COMPLETED = 'aonprd-page:completed';
const FAILED    = 'aonprd-page:failed';

/**
 * The `aonprd:page` plugin DAG — per-page chain for AON detail pages.
 * Chain: html:fetch → aonprd:parse (embedded) → json:write → completed
 * @category Plugin DAGs
 */
export const aonprdPageDAG: DAGType = (() => {
  const builder = new DAGBuilder('aonprd:page', '1.0');
  builder.node('html:fetch', HtmlFetchNode, { success: 'aonprd:parse', cached: 'aonprd:parse', error: FAILED });
  builder.embeddedDAG<ScrapeState, ScrapeState>('aonprd:parse', 'aonprd:parse', { success: 'json:write', error: FAILED }, {
    inputs:  { page: 'page' },
    outputs: { output: 'output' },
  });
  builder.node('json:write', JsonWriteNode, { success: COMPLETED, skipped: COMPLETED });
  builder.terminal(COMPLETED, { outcome: 'completed' });
  builder.terminal(FAILED,    { outcome: 'failed' });
  return builder.build();
})();
