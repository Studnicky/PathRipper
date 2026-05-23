// Familiar concept declaration.
import type { ConceptDecl } from '../../taxonomy.js';
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
  discriminator: { _type: 'familiar' },
};
