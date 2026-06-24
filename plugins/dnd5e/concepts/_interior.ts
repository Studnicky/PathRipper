// Interior concepts.
//
// `thing` registers the shared page-load + content-classification capability.
// `entity` exists to share capability chains downward; it adds none of its own
// beyond load-and-common for dnd5e. Leaf concepts (spell, generic) inherit from
// `entity`.
import { loadAndCommonNode } from '../nodes/loadAndCommon.js';
import type { ConceptDecl } from '../../../src/types/Taxonomy.js';

export const thingConcept: ConceptDecl = {
  id:           'thing',
  parent:       null,
  capabilities: [loadAndCommonNode],
};

export const entityConcept: ConceptDecl = {
  id:           'entity',
  parent:       'thing',
  capabilities: [],
};
