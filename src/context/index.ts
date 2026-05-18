/**
 * @fileoverview Side-effect bootstrap for every `context:*` lifecycle plugin.
 *
 * @remarks
 * A single `import './context/index.js'` wires every well-known run-wide
 * silo populator. Each child module's top-level
 * `TaskRegistry.registerHook('context:<name>', 'onRunStart', ...)` runs on
 * load, so by the time this module's evaluation finishes, the global
 * `TaskRegistry` carries every `context:*` `onRunStart` hook in the order
 * documented below.
 *
 * ## Deterministic import order (Amendment A6)
 *
 * The order below is FIXED. The orchestrator drives `onRunStart` hooks in
 * registration (insertion) order, so the import order here is the
 * orchestrator's execution order:
 *
 * 1. `logger`    — first so every later hook can call
 *                  `Logger.forComponent('context:<name>')` without bootstrapping
 *                  its own logger. The hook also populates `ctx.logger` so
 *                  classifier/enrich/finalize plugins can read it during
 *                  per-record execution.
 * 2. `ajv`       — populates `ctx.ajv`. Runs before any plugin that compiles
 *                  AJV schemas at startup (today: none in this list, but the
 *                  follow-on classifier plugins in tasks #15+ will rely on
 *                  this slot during their own `onRunStart` config-validate
 *                  step).
 * 3. `runTime`   — populates `ctx.runStartTime` (a single ISO string).
 *                  Independent of the others; placed early so any optional
 *                  consumer that wants a timestamp at hook construction has
 *                  it available.
 * 4. `dataset`   — populates `ctx.factory`, `ctx.dataset`, `ctx.builder`.
 *                  Must run before `prefixes` because `prefixes` mints
 *                  `NamedNode` graph IRIs through `ctx.factory`.
 * 5. `prefixes`  — populates `ctx.prefixes`, `ctx.iri`, `ctx.graphs`. Reads
 *                  `ctx.factory` from the dataset hook.
 * 6. `ontology`  — last because (a) it is conditional on
 *                  `targetConfig.ontology.engine === 'json-tology'`, and (b)
 *                  it is a lookup-only consumer of earlier slots. When
 *                  the ontology block is absent, the hook no-ops so the
 *                  optional `ctx.jt` slot stays absent — the silo contract
 *                  requires consumers (e.g. `ShaclShapeClassifier`) to
 *                  handle that themselves.
 *
 * ## Bridge keys
 *
 * `prefixes` and `ontology` read two private bridge keys off `ctx.config`
 * (`__sampleSource`, `__schemasBase`). These are TACTICAL only — they let
 * task #11 land before task #24 rewires the orchestrator to thread these
 * values via a proper init record. The bridge keys are NOT part of the
 * public silo contract and MUST NOT be added to `docs/context-silo.md`.
 *
 * ## Mutability
 *
 * Hooks receive the in-progress context as a `PipelineContextInterface`,
 * but each plugin internally narrows it to a writable view to assign its
 * slot. The orchestrator constructs the context as a mutable record, runs
 * every `onRunStart` hook in order, and only then exposes it to per-record
 * tasks via the read-only `PipelineContextInterface` shape.
 *
 * @module context
 * @category Context
 * @since 0.7.0
 */

import './logger.js';
import './ajv.js';
import './runTime.js';
import './dataset.js';
import './prefixes.js';
import './ontology.js';
