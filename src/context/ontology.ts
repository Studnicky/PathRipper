/**
 * @fileoverview `context:ontology` lifecycle plugin — populates `ctx.jt` when
 * `targetConfig.ontology.engine === "json-tology"`, otherwise no-ops.
 *
 * @remarks
 * Side-effect-registers an `onRunStart` hook on the global `TaskRegistry` at
 * import time. Mirrors today's `SquashageOrchestrator.#buildJtInstance` —
 * loads each schema file, parses it, and constructs a
 * {@link JsonTologyOntology} via its static `create`.
 *
 * Per the silo contract, `ctx.jt` is OPTIONAL: consumers
 * (`ShaclShapeClassifier`, `TaxonomicNarrowingClassifier`, `aonprd:squash`'s
 * typed-ABox path) MUST no-op when it is absent. This plugin therefore only
 * populates the slot when the engine is configured; on any other engine
 * value (including `undefined`) it leaves `ctx.jt` untouched.
 *
 * The orchestrator threads the schemas-base directory via the private
 * `ctx.config.__schemasBase` bridge key so this plugin can resolve relative
 * `schemaPath` entries without re-doing the orchestrator's
 * `dirname(configPath)` calculation.
 *
 * @todo follow-up cleanup: once the orchestrator threads `__schemasBase` via
 *   a typed init record instead of the context-config backdoor, drop the
 *   bridge key. The key is INTERNAL and MUST NOT appear in
 *   `docs/context-silo.md`.
 *
 * @module context/ontology
 * @category Context
 * @since 0.7.0
 */

import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';

import { TaskRegistry }              from '../registry/TaskRegistry.js';
import { Logger }                    from '../modules/logger/logger.js';
import { JsonTologyOntology }        from '../ontology/JsonTologyOntology.js';
import type { JsonTologySchemaInputInterface } from '../ontology/JsonTologyOntology.js';
import type { PipelineContextInterface } from '../types/PipelineState.js';

const log = Logger.forComponent('context:ontology');

type MutableContext = { -readonly [K in keyof PipelineContextInterface]: PipelineContextInterface[K] };

/**
 * Internal bridge interface for the schemas-base directory.
 *
 * @todo follow-up cleanup once the orchestrator threads this via a typed init
 *   record instead of a context-config backdoor. Internal — do NOT add to
 *   `docs/context-silo.md`.
 *
 * @internal
 */
interface CtxConfigBridgeInterface {
  readonly __schemasBase?: string | undefined;
}

interface RawSchemaEntryInterface {
  readonly schemaPath: string;
}

TaskRegistry.registerHook('context:ontology', 'onRunStart', async (ctx) => {
  const mut = ctx as MutableContext;
  if (mut.jt !== undefined) {
    log.debug('onRunStart', 'ctx.jt already populated; skipping overwrite');
    return;
  }

  const config        = ctx.config as Readonly<Record<string, unknown>> & CtxConfigBridgeInterface;
  const ontologyBlock = config['ontology'] as Readonly<Record<string, unknown>> | undefined;
  if (ontologyBlock === undefined) {
    log.debug('onRunStart', 'no ontology config; ctx.jt left absent');
    return;
  }

  const engine = ontologyBlock['engine'];
  if (engine !== 'json-tology') {
    log.debug('onRunStart', 'ontology.engine is not json-tology; ctx.jt left absent', { engine });
    return;
  }

  const baseIRI    = ontologyBlock['baseIRI'] as string;
  const rawSchemas = ontologyBlock['schemas'] as ReadonlyArray<RawSchemaEntryInterface> | undefined;
  if (rawSchemas === undefined || rawSchemas.length === 0) {
    log.debug('onRunStart', 'json-tology engine present but no schemas; ctx.jt left absent');
    return;
  }

  const schemasBase = config.__schemasBase ?? process.cwd();

  const schemaInputs: JsonTologySchemaInputInterface[] = await Promise.all(
    rawSchemas.map(async entry => {
      const absPath = resolvePath(schemasBase, entry.schemaPath);
      const text    = await readFile(absPath, 'utf8');
      const schema  = JSON.parse(text) as Record<string, unknown> & { readonly '$id': string };
      return { schemaPath: entry.schemaPath, schema };
    }),
  );

  log.debug('onRunStart', 'building JsonTologyOntology instance', {
    baseIRI,
    schemaCount: schemaInputs.length,
  });

  mut.jt = JsonTologyOntology.create({ baseIRI, schemas: schemaInputs });
});
