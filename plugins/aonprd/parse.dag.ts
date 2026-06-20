// Plugin DAG: aonprd:parse.
//
// Builds the AONPRD parse DAG from the compiled taxonomy via DAGBuilder.
// The taxonomy compiles the concept tree into routing annotations and
// translates them into explicit DAGBuilder placements via `buildDAG()`.
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
export const aonprdParseDAG: DAGType = TAXONOMY.buildDAG('aonprd:parse', '3.0');
