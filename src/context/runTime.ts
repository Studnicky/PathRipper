/**
 * @fileoverview `context:run-time` lifecycle plugin — populates
 * `ctx.runStartTime` with an ISO 8601 timestamp frozen at run start.
 *
 * @remarks
 * Side-effect-registers an `onRunStart` hook on the global `TaskRegistry` at
 * import time. The single timestamp is consumed by `output:provenance` to
 * stamp every provenance quad in the run with the same value, preserving
 * deterministic round-trips across replays.
 *
 * Idempotent: if `ctx.runStartTime` is already populated, the hook skips
 * with a debug log so tests can pre-seed a stable timestamp.
 *
 * @module context/runTime
 * @category Context
 * @since 0.7.0
 */

import { TaskRegistry }              from '../registry/TaskRegistry.js';
import { Logger }                    from '../modules/logger/logger.js';
import type { PipelineContextInterface } from '../types/PipelineState.js';

const log = Logger.forComponent('context:run-time');

type MutableContext = { -readonly [K in keyof PipelineContextInterface]: PipelineContextInterface[K] };

TaskRegistry.registerHook('context:run-time', 'onRunStart', (ctx) => {
  const mut = ctx as MutableContext;
  if (mut.runStartTime !== undefined) {
    log.debug('onRunStart', 'ctx.runStartTime already populated; skipping overwrite');
    return;
  }
  mut.runStartTime = new Date().toISOString();
  log.debug('onRunStart', 'ctx.runStartTime populated', { runStartTime: mut.runStartTime });
});
