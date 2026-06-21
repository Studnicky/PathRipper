// Plugin DAG: aonprd:page.
//
// Per-page chain: fetch HTML, parse via the aonprd:parse sub-DAG, write JSON.
import { DAGBuilder } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';

import type { ScrapeState } from '../../src/state/ScrapeState.js';
import { HtmlFetchNode, JsonWriteNode, CaptureErrorNode } from '../../src/nodes/index.js';

const COMPLETED = 'aonprd-page:completed';
const CAPTURE   = 'error:capture';

/**
 * The `aonprd:page` plugin DAG — per-page chain for AON detail pages.
 *
 * Chain: html:fetch → aonprd:parse (embedded) → json:write → completed.
 * The `error` ports of `html:fetch` and `aonprd:parse` route to `error:capture`,
 * which projects `state.errors` into an `{ _type: 'error' }` document that
 * `json:write` persists to disk — failures are written, inspectable data, not a
 * swallowed exception (which is otherwise opaque across the worker boundary).
 *
 * @category Plugin DAGs
 */
export const aonprdPageDAG: DAGType = (() => {
  const builder = new DAGBuilder('aonprd:page', '1.0');
  builder.node('html:fetch', HtmlFetchNode, { success: 'aonprd:parse', cached: 'aonprd:parse', retry: 'html:fetch', error: CAPTURE });
  builder.embeddedDAG<ScrapeState, ScrapeState>('aonprd:parse', 'aonprd:parse', { success: 'json:write', error: CAPTURE }, {
    inputs:  { page: 'page' },
    outputs: { output: 'output' },
  });
  builder.node(CAPTURE, CaptureErrorNode, { captured: 'json:write' });
  builder.node('json:write', JsonWriteNode, { success: COMPLETED, skipped: COMPLETED });
  builder.terminal(COMPLETED, { outcome: 'completed' });
  return builder.build();
})();
