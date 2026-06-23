// Secondary plugin taxonomy — Wave 5 proof-of-concept.
//
// Demonstrates that the AONPRD Layer-1 capability binaries
// (`labelPairBlockNode`, `sectionWalkerNode`, `sourceRefNode`,
// `metaTagsNode`) can be reused by a different plugin so long as the plugin
// supplies its own `CommonStrategy` to `makeLoadAndCommonNode`.
//
// The `loadAndCommon` node here is constructed from the SAME factory the AON
// plugin uses, but bound to `secondaryStrategy` instead of `aonStrategy`. The
// downstream Layer-1 caps (which read from `aonprdCommon` metadata) are
// imported VERBATIM from `plugins/aonprd/capabilities/` — proving the binary
// is shared.
import { makeLoadAndCommonNode } from '../aonprd/nodes/loadAndCommon.js';
import { labelPairBlockNode } from '../aonprd/capabilities/labelPairBlock.js';
import { sectionWalkerNode }  from '../aonprd/capabilities/sectionWalker.js';
import { sourceRefNode }      from '../aonprd/capabilities/sourceRef.js';
import { metaTagsNode }       from '../aonprd/capabilities/metaTags.js';
import { Taxonomy }           from '../../src/taxonomy/Taxonomy.js';
import type { ConceptDecl }   from '../../src/taxonomy/Taxonomy.js';

import { secondaryStrategy } from './strategies/secondary.js';
import { sampleConcept }     from './concepts/sample.js';

const secondaryLoadAndCommonNode = makeLoadAndCommonNode(secondaryStrategy);

const thingConcept: ConceptDecl = {
  id:     'thing',
  parent: null,
  capabilities: [secondaryLoadAndCommonNode],
};

const entityConcept: ConceptDecl = {
  id:     'entity',
  parent: 'thing',
  capabilities: [
    labelPairBlockNode,
    sectionWalkerNode,
    sourceRefNode,
    metaTagsNode,
  ],
};

export const SECONDARY_TAXONOMY = [
  thingConcept,
  entityConcept,
  sampleConcept,
] as const satisfies readonly ConceptDecl<unknown>[];

function extractSecondaryPath(url: string): string | null {
  const match = /\/([A-Za-z]+)\.aspx/i.exec(url);
  return match !== null ? match[1]!.toLowerCase() : null;
}

/** Compiled secondary taxonomy — provides `routeUrl`, `chainFor`, `allNodes`. */
export const TAXONOMY = Taxonomy.compile(SECONDARY_TAXONOMY, { namespace: 'secondary', pathExtractor: extractSecondaryPath });
