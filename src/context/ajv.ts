/**
 * @fileoverview `context:ajv` lifecycle plugin — populates `ctx.ajv` with the
 * run-wide shared AJV instance.
 *
 * @remarks
 * Side-effect-registers an `onRunStart` hook on the global `TaskRegistry` at
 * import time. Builds one AJV instance per run with the standard squashage
 * options (`allErrors`, `strict`, `useDefaults: false`) and applies
 * `addFormats` from `ajv-formats`. Future plugins that compile JSON Schemas
 * (config validation, `classify:schema`, custom keyword registrants) reuse
 * this single instance via `ctx.ajv`.
 *
 * Idempotent: if `ctx.ajv` is already populated (test scaffolding), the hook
 * skips with a debug log.
 *
 * Imports must follow the dual-CJS/ESM `default` unwrap idiom used throughout
 * the codebase (see `src/classification/ClassificationFactory.ts` lines
 * 53-54).
 *
 * @module context/ajv
 * @category Context
 * @since 0.7.0
 */

import AjvModule       from 'ajv';
import addFormatsModule from 'ajv-formats';

import { TaskRegistry }                from '../registry/TaskRegistry.js';
import { Logger }                      from '../modules/logger/logger.js';
import type { AjvCtorType, AddFormatsFnInterface } from '../types/AjvInterop.js';
import type { PipelineContextInterface }           from '../types/PipelineState.js';

// AJV 8.x dual-CJS/ESM; NodeNext resolves default on `.default`.
const Ajv        = (AjvModule        as unknown as { default?: AjvCtorType }).default        ?? (AjvModule        as unknown as AjvCtorType);
const addFormats = (addFormatsModule as unknown as { default?: AddFormatsFnInterface }).default ?? (addFormatsModule as unknown as AddFormatsFnInterface);

const log = Logger.forComponent('context:ajv');

type MutableContext = { -readonly [K in keyof PipelineContextInterface]: PipelineContextInterface[K] };

TaskRegistry.registerHook('context:ajv', 'onRunStart', (ctx) => {
  const mut = ctx as MutableContext;
  if (mut.ajv !== undefined) {
    log.debug('onRunStart', 'ctx.ajv already populated; skipping overwrite');
    return;
  }
  const ajv = new Ajv({ allErrors: true, strict: true, useDefaults: false });
  addFormats(ajv);
  mut.ajv = ajv;
  log.debug('onRunStart', 'ctx.ajv populated', { strict: true, allErrors: true });
});
