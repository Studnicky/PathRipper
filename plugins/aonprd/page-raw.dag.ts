// Plugin DAG: aonprd:page-raw.
//
// Phase-1 / raw-only per-page chain: fetch HTML, write raw HTML to disk.
// NO parse step — used to warm a cache and snapshot raw bodies before a
// later zero-network parse pass.
import { DAGBuilder } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';

import { HtmlFetchNode, HtmlWriteRawNode, JsonWriteNode, CaptureErrorNode, RouteFailureNode } from '../../src/nodes/index.js';

const COMPLETED = 'aonprd-page-raw:completed';
const CAPTURE   = 'error:capture';

/**
 * The `aonprd:page-raw` plugin DAG — per-page raw-only chain for AON detail pages.
 *
 * Chain: html:fetch → html:write-raw → completed. A fetch failure routes to
 * `error:capture`, which projects `state.errors` into an `{ _type: 'error' }`
 * document that `json:write` persists — raw-pass fetch failures are inspectable
 * data, not a swallowed exception.
 *
 * @category Plugin DAGs
 */
export const aonprdPageRawDAG: DAGType = (() => {
  const builder = new DAGBuilder('aonprd:page-raw', '1.0');
  builder.node('html:fetch', HtmlFetchNode, { success: 'html:write-raw', cached: 'html:write-raw', error: 'route:failure' });
  builder.node('html:write-raw', HtmlWriteRawNode, { success: COMPLETED });
  builder.node(CAPTURE, CaptureErrorNode, { captured: 'json:write' });
  builder.node('route:failure', RouteFailureNode, { retry: 'html:fetch', resolve: CAPTURE, capture: CAPTURE, expected: COMPLETED });
  builder.node('json:write', JsonWriteNode, { success: COMPLETED, skipped: COMPLETED });
  builder.terminal(COMPLETED, { outcome: 'completed' });
  return builder.build();
})();
