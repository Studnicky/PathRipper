// Animal-companion re-exports.
export type {
  AnimalCompanionVariant,
  AnimalCompanionRef,
  AnimalCompanionAbilities,
  AnimalCompanionStrike,
  AnimalCompanionModification,
  AnimalCompanionOutput,
  AnimalCompanionBaseSlice,
  AnimalCompanionStatsSlice,
  AnimalCompanionCombatSlice,
  AnimalCompanionAdvancementSlice,
  AnimalCompanionMetaSlice,
} from './types.js';

export {
  extractAnimalCompanionBase,
} from './base.js';

export {
  extractAnimalCompanionStats,
} from './stats.js';

export {
  extractAnimalCompanionCombat,
} from './combat.js';

export {
  extractAnimalCompanionAdvancement,
} from './advancement.js';

export {
  extractAnimalCompanionMeta,
} from './meta.js';

export {
  finalizeAnimalCompanion,
} from './finalize.js';

export {
  animalCompanionBaseNode,
  animalCompanionStatsNode,
  animalCompanionCombatNode,
  animalCompanionAdvancementNode,
  finalizeAnimalCompanionNode,
} from './nodes.js';

export {
  animalCompanionConcept,
} from './concept.js';
