// Familiar concept declaration.
import type { ConceptDecl } from '../../../../src/taxonomy/Taxonomy.js';
import type { FamiliarOutput } from './types.js';
import {
  familiarBaseNode,
  familiarPrerequisitesNode,
  finalizeFamiliarNode,
} from './nodes.js';

export const familiarConcept: ConceptDecl<FamiliarOutput> = {
  id:       'familiar',
  parent:   'entity',
  urlPaths: ['familiars'],
  capabilities: [
    familiarBaseNode,
    familiarPrerequisitesNode,
    finalizeFamiliarNode,
  ],
};
