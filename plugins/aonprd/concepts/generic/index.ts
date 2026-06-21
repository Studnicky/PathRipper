// Generic concept exports.

export type {
  GenericOutput,
  UnknownOutput,
  ConditionOutput,
  TraitOutput,
  HazardOutput,
} from './types.js';

export { genericConcept } from './concept.js';

// Critical re-export: makeUnknown is imported by unknownTerminal.ts
export { makeUnknown } from './generic.js';
