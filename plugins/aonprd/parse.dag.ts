// Plugin DAG: aonprd:parse — Phase 6.4 cut-over.
//
// Replaces the 435-line hand-written contract table with a taxonomy-derived
// DAG. `DAGDeriver.derive` receives the node list and routing annotations
// produced by the compiled AONPRD taxonomy.
import { DAGDeriver } from '@noocodex/dagonizer/derive';
import type { DAG, NodeInterface, NodeStateInterface } from '@noocodex/dagonizer';

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
// DAGDeriver.derive's `nodes` parameter is typed as
// `readonly NodeInterface<NodeStateInterface, string, undefined>[]`. Our
// taxonomy nodes carry `TServices = RipperServices`, which the dispatcher
// re-injects at execute() time. The deriver only inspects `name`, `outputs`,
// and `contract` — none of which touch `TServices` — so the cast at this
// boundary is safe.
export const aonprdParseDAG: DAG = DAGDeriver.derive({
  name:        'aonprd:parse',
  version:     '3.0',
  entrypoint:  TAXONOMY.entrypoint(),
  nodes:       TAXONOMY.allNodes() as unknown as readonly NodeInterface<NodeStateInterface, string, undefined>[],
  annotations: TAXONOMY.annotations(),
});
