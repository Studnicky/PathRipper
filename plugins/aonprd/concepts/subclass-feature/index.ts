/**
 * Subclass-feature concept — public exports.
 */
export { subclassFeatureConcept } from './concept.js';
export type { SubclassFeatureOutput } from './types.js';
export { subclassFeatureBaseNode } from './concept.js';
export { subclassFeatureFieldsNode } from './concept.js';
export { subclassFeatureSpellsNode } from './concept.js';
export { subclassFeatureFeaturesNode } from './concept.js';
export { finalizeSubclassFeatureNode } from './concept.js';
// Re-export for tests that import directly
export { extractSubclassFeature } from './finalize.js';
export type {
  SubclassFeatureBaseOutput,
  SubclassFeatureFieldsOutput,
  SubclassFeatureSpellsOutput,
  SubclassFeatureFeaturesOutput,
  FinalizeSubclassFeatureOutput,
} from './concept.js';
