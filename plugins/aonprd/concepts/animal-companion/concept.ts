// Animal-companion concept declaration.
import type { ConceptDecl } from '../../taxonomy.js';
import type { AnimalCompanionOutput } from './types.js';
import {
  animalCompanionBaseNode,
  animalCompanionStatsNode,
  animalCompanionCombatNode,
  animalCompanionAdvancementNode,
  finalizeAnimalCompanionNode,
} from './nodes.js';

export const animalCompanionConcept: ConceptDecl<AnimalCompanionOutput> = {
  id:       'animal-companion',
  parent:   'entity',
  urlPaths: ['companions'],
  capabilities: [
    animalCompanionBaseNode,
    animalCompanionStatsNode,
    animalCompanionCombatNode,
    animalCompanionAdvancementNode,
    finalizeAnimalCompanionNode,
  ],
};
