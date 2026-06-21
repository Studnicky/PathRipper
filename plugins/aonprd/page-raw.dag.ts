// Plugin DAG: aonprd:page-raw.
//
// Phase-1 / raw-only per-page chain: fetch HTML, write raw HTML to disk.
// NO parse step — used to warm a cache and snapshot raw bodies before a
// later zero-network parse pass.
import { DAGBuilder } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';

import { HtmlFetchNode, HtmlWriteRawNode } from '../../src/nodes/index.js';

const COMPLETED = 'aonprd-page-raw:completed';
const FAILED    = 'aonprd-page-raw:failed';

/**
 * The `aonprd:page-raw` plugin DAG — per-page raw-only chain for AON detail pages.
 * Chain: html:fetch → html:write-raw → completed
 * @category Plugin DAGs
 */
export const aonprdPageRawDAG: DAGType = (() => {
  const builder = new DAGBuilder('aonprd:page-raw', '1.0');
  builder.node('html:fetch', HtmlFetchNode, { success: 'html:write-raw', cached: 'html:write-raw', error: FAILED });
  builder.node('html:write-raw', HtmlWriteRawNode, { success: COMPLETED });
  builder.terminal(COMPLETED, { outcome: 'completed' });
  builder.terminal(FAILED,    { outcome: 'failed' });
  return builder.build();
})();
