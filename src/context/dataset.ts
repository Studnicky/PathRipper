/**
 * @fileoverview `context:dataset` lifecycle plugin — populates `ctx.factory`,
 * `ctx.dataset`, and `ctx.builder` from the run's base IRI.
 *
 * @remarks
 * Side-effect-registers an `onRunStart` hook on the global `TaskRegistry` at
 * import time. Mirrors the `factory` / `dataset` / `builder` block of today's
 * `SquashageOrchestrator.#buildContext` so plugins that emit quads have
 * everything they need on the silo before per-record dispatch.
 *
 * The base IRI comes from `ctx.config.ontology?.baseIri ?? 'https://example.org/'`
 * — the orchestrator populates `ctx.config` (the frozen target config) before
 * running any `onRunStart` hook, so this plugin can read it directly.
 *
 * Idempotent: each slot is only assigned when absent, so test scaffolding may
 * pre-seed (e.g.) `ctx.dataset` with an in-memory store.
 *
 * @module context/dataset
 * @category Context
 * @since 0.7.0
 */

import { TaskRegistry }              from '../registry/TaskRegistry.js';
import { Logger }                    from '../modules/logger/logger.js';
import { dataFactory }               from '../rdf/DataFactory.js';
import { Dataset }                   from '../rdf/Dataset.js';
import { GraphBuilder }              from '../rdf/GraphBuilder.js';
import type { PipelineContextInterface } from '../types/PipelineState.js';

const log = Logger.forComponent('context:dataset');

type MutableContext = { -readonly [K in keyof PipelineContextInterface]: PipelineContextInterface[K] };

/**
 * Resolves the base IRI for `GraphBuilder` from the target config's
 * `ontology.baseIri`, falling back to the same synthetic origin used today
 * by `SquashageOrchestrator.#buildContext`.
 */
function resolveBaseIri(config: Readonly<Record<string, unknown>>): string {
  const ontology = config['ontology'] as Readonly<Record<string, unknown>> | undefined;
  const candidate = ontology?.['baseIri'];
  return typeof candidate === 'string' && candidate.length > 0
    ? candidate
    : 'https://example.org/';
}

TaskRegistry.registerHook('context:dataset', 'onRunStart', (ctx) => {
  const mut    = ctx as MutableContext;
  const baseIri = resolveBaseIri(ctx.config);

  let assignedFactory = false;
  let assignedDataset = false;
  let assignedBuilder = false;

  if (mut.factory === undefined) {
    mut.factory = dataFactory;
    assignedFactory = true;
  }
  if (mut.dataset === undefined) {
    mut.dataset = Dataset.empty();
    assignedDataset = true;
  }
  if (mut.builder === undefined) {
    mut.builder = new GraphBuilder(baseIri);
    assignedBuilder = true;
  }

  log.debug('onRunStart', 'ctx.factory/dataset/builder populated', {
    baseIri,
    assignedFactory,
    assignedDataset,
    assignedBuilder,
  });
});
