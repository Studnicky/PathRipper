// AON plugin registration entry for the native DAG-document contract.
//
// Exports:
//   - `register(dispatcher)` — registers all taxonomy node INSTANCES.
//
// DAGs are NOT registered here — the runner loads *.dag.jsonld documents
// from this plugin directory and calls `dispatcher.registerDAG` for each.
// Builtin nodes (html:fetch, json:write, etc.) are registered by the
// runner's `PluginLoader.registerBuiltinNodes` — do NOT register them here.

import type { RipperDagonizer } from '../../src/dispatcher/RipperDagonizer.js';
import type { ScrapeState }     from '../../src/state/ScrapeState.js';

import { TAXONOMY } from './taxonomy/aonprd.js';

/** Register the aonprd plugin's node INSTANCES. DAGs are loaded from the *.dag.jsonld documents by the runner. */
export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  for (const node of TAXONOMY.allNodes()) dispatcher.registerNode(node);
}
