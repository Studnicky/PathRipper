// dnd5e plugin registration entry.
//
// Registers the plugin's node INSTANCES. DAGs are loaded from *.dag.jsonld
// documents by the runner; builtin nodes are registered by the runner's
// PluginLoader — do NOT register them here.
import type { RipperDagonizer } from '../../src/dispatcher/RipperDagonizer.js';
import type { ScrapeState }     from '../../src/state/ScrapeState.js';

import { TAXONOMY } from './taxonomy/dnd5e.js';

/** Register the dnd5e plugin's node INSTANCES. */
export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  for (const node of TAXONOMY.allNodes()) dispatcher.registerNode(node);
}
