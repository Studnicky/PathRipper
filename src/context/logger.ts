/**
 * @fileoverview `context:logger` lifecycle plugin — populates `ctx.logger` with
 * the run-wide logger factory.
 *
 * @remarks
 * Side-effect-registers an `onRunStart` hook on the global `TaskRegistry` at
 * import time. The concrete `Logger` class in `src/modules/logger/logger.ts`
 * already satisfies `LoggerFactoryInterface` via its static `forComponent`,
 * so the hook simply assigns the class itself as the factory.
 *
 * Idempotent: if `ctx.logger` is already populated (e.g. test scaffolding
 * pre-loaded a stub factory), the hook logs a debug line and skips the
 * overwrite.
 *
 * Per the silo contract, this is the FIRST `onRunStart` hook in the
 * deterministic import order (`src/context/index.ts`) so every later plugin
 * may rely on `ctx.logger` being populated.
 *
 * @module context/logger
 * @category Context
 * @since 0.7.0
 */

import { TaskRegistry }              from '../registry/TaskRegistry.js';
import { Logger }                    from '../modules/logger/logger.js';
import type { LoggerFactoryInterface } from '../types/Logger.js';
import type { PipelineContextInterface } from '../types/PipelineState.js';

const log = Logger.forComponent('context:logger');

/**
 * Mutable view of the run-wide context — used internally so the hook can
 * write to `ctx.logger`. The user-visible `PipelineContextInterface` keeps
 * its `readonly` markers; the orchestrator constructs the context as a
 * mutable record, runs hooks, then exposes it through the read-only view.
 */
type MutableContext = { -readonly [K in keyof PipelineContextInterface]: PipelineContextInterface[K] };

TaskRegistry.registerHook('context:logger', 'onRunStart', (ctx) => {
  const mut = ctx as MutableContext;
  if (mut.logger !== undefined) {
    log.debug('onRunStart', 'ctx.logger already populated; skipping overwrite');
    return;
  }
  mut.logger = Logger as unknown as LoggerFactoryInterface;
  log.debug('onRunStart', 'ctx.logger populated');
});
