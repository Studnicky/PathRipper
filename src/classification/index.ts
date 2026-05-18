/**
 * @fileoverview Side-effect bootstrap for every `classify:*` plugin module.
 *
 * @remarks
 * A single `import './classification/index.js'` registers all eleven classifier
 * plugins on the global {@link TaskRegistry}. Each child module's top-level
 * `TaskRegistry.register(...)` and `TaskRegistry.registerHook(...)` calls run
 * on load, so by the time this module's evaluation finishes, the global
 * registry carries every per-record `classify:*` task and its corresponding
 * `onRunStart` lifecycle hook.
 *
 * ## Import order rationale (Amendment A6)
 *
 * The import order below is **alphabetical** and intentionally so. Classifier
 * plugins do NOT have inter-plugin silo dependencies — every classifier's
 * dependencies are on context plugins from `src/context/index.ts`
 * (Task #11), which run first via the orchestrator's two-phase startup
 * (every `context:*` `onRunStart` hook fires before any `classify:*`
 * `onRunStart` hook executes against the populated silo). Alphabetical here
 * is purely for readability and merge-conflict resistance, not for runtime
 * ordering. The orchestrator drives `onRunStart` hooks in registration
 * (insertion) order, so this file's order IS the orchestrator's classifier
 * execution order — but no classifier observes another classifier's silo
 * writes during `onRunStart`, so the order is only a stylistic choice.
 *
 * ## TaskRegistry side effects on a fresh instance
 *
 * The plugin modules call the static `TaskRegistry` singleton — they do
 * NOT auto-register on a freshly constructed `TaskRegistry` instance built
 * inside a unit test. The side effects fire on the singleton only when this
 * file (or one of the child modules) is imported. Tests that build their own
 * `TaskRegistry` instance start empty by design.
 *
 * ## Aggregator placement in the bootstrap chain
 *
 * The orchestrator and CLI both `import './tasks/index.js'` once at startup,
 * and `src/tasks/index.ts` in turn imports both this aggregator and
 * `../context/index.js`. Importing `src/tasks/index.js` is therefore the
 * canonical single-line bootstrap that wires built-in pipeline tasks,
 * classifier plugins, AND context lifecycle hooks onto the global
 * `TaskRegistry`.
 *
 * @module classification
 * @category Classification
 * @since 0.7.0
 */

import './tasks/ConflictResolver.js';
import './tasks/OntologyClassifier.js';
import './tasks/PropertyFingerprintClassifier.js';
import './tasks/RulesClassifier.js';
import './tasks/SchemaClassifier.js';
import './tasks/ShaclShapeClassifier.js';
import './tasks/SourceClassifier.js';
import './tasks/StructuralClassifier.js';
import './tasks/TaxonomicNarrowingClassifier.js';
import './tasks/UrlPatternClassifier.js';
import './tasks/WinknlpEntitiesClassifier.js';
