// Plugin DAG: aonprd:parse.
//
// Replaces the 435-line hand-written contract table with a taxonomy-derived
// DAG. `DAGDeriver.derive` receives the node list and routing annotations
// produced by the compiled AONPRD taxonomy.
import { DAGDeriver } from '@studnicky/dagonizer/derive';
import type { DAGType } from '@studnicky/dagonizer';

import { TAXONOMY } from './taxonomy/aonprd.js';

/**
 * The `aonprd:parse` plugin DAG — built from the compiled AONPRD taxonomy.
 *
 * Entrypoint is `aonprd:taxonomy-route` which dispatches to each concept's
 * inherited capability chain. Unrecognised URLs route to `aonprd:make-unknown`.
 *
 * @category Plugin DAGs
 * @since 3.0.0
 */
export const aonprdParseDAG: DAGType = DAGDeriver.derive({
  name:        'aonprd:parse',
  version:     '3.0',
  entrypoint:  TAXONOMY.entrypoint(),
  nodes:       [...TAXONOMY.allNodes()],
  annotations: TAXONOMY.annotations(),
});
