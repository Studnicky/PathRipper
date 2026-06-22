/**
 * Generic classifier node classes — framework building blocks.
 *
 * Plugin authors import these classes and config interfaces, instantiate them
 * with their own config, and register the instances on the dispatcher.
 * The framework does NOT register any of these itself.
 */

export { DiscriminatorClassifierNode } from '../nodes/record/classifiers/DiscriminatorClassifierNode.js';
export type { DiscriminatorClassifierConfigInterface } from '../nodes/record/classifiers/DiscriminatorClassifierNode.js';

export { UrlPatternClassifierNode } from '../nodes/record/classifiers/UrlPatternClassifierNode.js';
export type { UrlPatternConfigInterface, UrlPatternEntryInterface } from '../nodes/record/classifiers/UrlPatternClassifierNode.js';

export { StructuralClassifierNode } from '../nodes/record/classifiers/StructuralClassifierNode.js';
export type { RawStructuralRuleInterface } from '../nodes/record/classifiers/StructuralClassifierNode.js';

export { RulesClassifierNode } from '../nodes/record/classifiers/RulesClassifierNode.js';
export type { RawRulesEntryInterface } from '../nodes/record/classifiers/RulesClassifierNode.js';

export { SchemaClassifierNode } from '../nodes/record/classifiers/SchemaClassifierNode.js';
export type { RawSchemaEntryInterface } from '../nodes/record/classifiers/SchemaClassifierNode.js';

export { ShaclShapeClassifierNode } from '../nodes/record/classifiers/ShaclShapeClassifierNode.js';
export type { ShaclShapeClassifierConfigInterface } from '../nodes/record/classifiers/ShaclShapeClassifierNode.js';

export { PropertyFingerprintClassifierNode } from '../nodes/record/classifiers/PropertyFingerprintClassifierNode.js';
export type { PropertyFingerprintConfigInterface } from '../nodes/record/classifiers/PropertyFingerprintClassifierNode.js';

export { WinknlpEntitiesClassifierNode } from '../nodes/record/classifiers/WinknlpEntitiesClassifierNode.js';
export type { WinknlpEntitiesConfigInterface, WinknlpPatternEntryInterface } from '../nodes/record/classifiers/WinknlpEntitiesClassifierNode.js';

export { OntologyClassifierNode } from '../nodes/record/classifiers/OntologyClassifierNode.js';
export type { OntologyClassifierConfigInterface } from '../nodes/record/classifiers/OntologyClassifierNode.js';

export { TaxonomicNarrowingClassifierNode } from '../nodes/record/classifiers/TaxonomicNarrowingClassifierNode.js';
export type { TaxonomicNarrowingConfigInterface } from '../nodes/record/classifiers/TaxonomicNarrowingClassifierNode.js';

export { ClassifyConflictNode } from '../nodes/record/classifyConflict.js';
export type { ClassifyConflictConfigInterface } from '../nodes/record/classifyConflict.js';
