/**
 * @fileoverview `context:prefixes` lifecycle plugin — populates `ctx.prefixes`,
 * `ctx.iri`, and `ctx.graphs`.
 *
 * @remarks
 * Side-effect-registers an `onRunStart` hook on the global `TaskRegistry` at
 * import time. Resolves the three prefix-base pairs (instances, graphs,
 * vocabulary) via {@link PrefixResolver.resolve}, builds the
 * {@link NamespaceBuilder} for the target's vocabulary base, and freezes the
 * named-graph IRI map.
 *
 * Depends on `ctx.factory` being populated already (used to mint `NamedNode`
 * graph IRIs). The deterministic import order in `src/context/index.ts`
 * guarantees this — `context:dataset` runs before `context:prefixes`.
 *
 * The orchestrator threads two config-time values to this plugin via private
 * keys on `ctx.config`:
 *
 * - {@link CtxConfigBridgeInterface.__sampleSource} — the first record's
 *   `_source` block, used by `PrefixResolver` to derive an instance base from
 *   the source URL host.
 *
 * @todo follow-up cleanup: once the orchestrator threads these via a typed
 *   init record instead of a config-back-channel, drop the bridge key. The
 *   key is INTERNAL and MUST NOT appear in `docs/context-silo.md`.
 *
 * @module context/prefixes
 * @category Context
 * @since 0.7.0
 */

import type { NamedNode } from '@rdfjs/types';

import { TaskRegistry }              from '../registry/TaskRegistry.js';
import { Logger }                    from '../modules/logger/logger.js';
import { PrefixResolver }            from '../classification/PrefixResolver.js';
import type { PrefixResolutionInterface } from '../classification/PrefixResolver.js';
import { Namespaces }                from '../rdf/Namespaces.js';
import type { TargetConfigInterface } from '../config/SquashageConfig.js';
import type { InputSourceInterface, PipelineContextInterface } from '../types/PipelineState.js';

const log = Logger.forComponent('context:prefixes');

type MutableContext = { -readonly [K in keyof PipelineContextInterface]: PipelineContextInterface[K] };

/**
 * Bridge slots the orchestrator writes onto `ctx.config` so context plugins
 * can pick up config-time values that aren't (yet) first-class context keys.
 *
 * @todo follow-up cleanup once the orchestrator threads these via a typed
 *   init record instead of a context-config backdoor. NOT part of the public
 *   silo contract — do NOT add to `docs/context-silo.md`.
 *
 * @internal
 */
interface CtxConfigBridgeInterface {
  /** First-record `_source` for prefix derivation (`PrefixResolver.resolve`). */
  readonly __sampleSource?: InputSourceInterface | undefined;
  /** Schemas base directory (json-tology schema-path resolution). */
  readonly __schemasBase?:  string                | undefined;
}

function resolveBaseIri(config: Readonly<Record<string, unknown>>): string {
  const ontology = config['ontology'] as Readonly<Record<string, unknown>> | undefined;
  const candidate = ontology?.['baseIri'];
  return typeof candidate === 'string' && candidate.length > 0
    ? candidate
    : 'https://example.org/';
}

TaskRegistry.registerHook('context:prefixes', 'onRunStart', (ctx) => {
  const mut    = ctx as MutableContext;
  const config = ctx.config as Readonly<Record<string, unknown>> & CtxConfigBridgeInterface;

  // Resolve the three prefix-base pairs.
  if (mut.prefixes === undefined) {
    const resolution: PrefixResolutionInterface = PrefixResolver.resolve(
      ctx.target,
      config as unknown as TargetConfigInterface,
      config.__sampleSource,
    );
    mut.prefixes = resolution;
  }

  // IRI builder for the target vocabulary base.
  if (mut.iri === undefined) {
    mut.iri = Namespaces.for(resolveBaseIri(config));
  }

  // Named-graph IRI map.
  if (mut.graphs === undefined) {
    const factory  = mut.factory;
    if (factory === undefined) {
      throw new Error(
        'context:prefixes requires ctx.factory; ensure context:dataset runs first.',
      );
    }
    const rawGraphs = (config['graphs'] ?? {}) as Readonly<Record<string, string>>;
    const graphs    = Object.fromEntries(
      Object.entries(rawGraphs).map<[string, NamedNode]>(([k, v]) => [k, factory.namedNode(v)]),
    );
    mut.graphs = Object.freeze(graphs);
  }

  log.debug('onRunStart', 'ctx.prefixes/iri/graphs populated', {
    prefixSource: mut.prefixes.source,
    instanceBase: mut.prefixes.instances.base,
  });
});
