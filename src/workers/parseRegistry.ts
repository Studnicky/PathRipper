/**
 * parseRegistry — general-purpose worker-thread RegistryModuleInterface.
 *
 * `WorkerThreadContainer` dynamic-imports this file inside each worker thread.
 * `DagHost` calls `registry.instantiate(servicesConfig)` to reconstruct whatever
 * plugin parse DAG the run uses — driven entirely by `servicesConfig` forwarded
 * from the coordinator, not by a hardcoded import of any specific plugin.
 *
 * `servicesConfig` carries `{ configDir: string; pipelineNames: string[] }`.
 * Bundle reconstruction is delegated to `PluginLoader.bundle`, the same loader
 * the in-process coordinator path uses — so worker mode and in-process mode
 * register an identical node + DAG set for any plugin.
 *
 * `services` is `undefined`: the parse pipeline reads `state.page.html` and
 * writes `state.output` — no external services (http, cache, fs) are needed.
 *
 * Worker import model:
 *   `DagHost` loads this module via a dynamic `import(registryModuleUrl)`, which
 *   the tsx loader (inherited through `process.execArgv`) resolves to `.ts` in
 *   dev/test and to the compiled `.js` in production. The registry's own static
 *   imports resolve the same way. `runHtml.ts` selects the matching extension
 *   from `import.meta.url` when it constructs the registry URL.
 *
 * @module workers/parseRegistry
 * @since 4.1.0
 */

import type { RegistryBundleInterface, RegistryModuleInterface } from '@studnicky/dagonizer/contracts';
import { CheckpointRestoreAdapter } from '@studnicky/dagonizer/checkpoint';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';

import { PluginLoader } from '../run/PluginLoader.js';
import { ScrapeState }  from '../state/ScrapeState.js';

// ── Registry ───────────────────────────────────────────────────────────────────

/**
 * General-purpose worker-thread registry for any plugin parse DAG.
 *
 * Exported as the module default so `DagHost` can dynamic-import this file and
 * call `registry.instantiate(servicesConfig)` on the returned object.
 *
 * `instantiate` reads `configDir` and `pipelineNames` from `servicesConfig`,
 * validates them defensively, then delegates to `PluginLoader.bundle` to
 * reconstruct the full node + DAG set. No plugin is imported by name in this
 * file — the plugin loaded depends entirely on the run's pipeline configuration
 * forwarded from the coordinator.
 */
const registry: RegistryModuleInterface = {
  async instantiate(servicesConfig: JsonObjectType): Promise<RegistryBundleInterface> {
    const rawConfigDir     = servicesConfig['configDir'];
    const rawPipelineNames = servicesConfig['pipelineNames'];

    if (typeof rawConfigDir !== 'string' || !Array.isArray(rawPipelineNames)) {
      throw new Error(
        'parseRegistry.instantiate requires servicesConfig.configDir: string '
        + 'and servicesConfig.pipelineNames: string[]',
      );
    }

    const configDir     = rawConfigDir;
    const pipelineNames  = rawPipelineNames.filter(
      (entry): entry is string => typeof entry === 'string',
    );

    const { bundle } = await PluginLoader.bundle(pipelineNames, configDir);

    const registryBundle: RegistryBundleInterface = {
      bundle,
      services:        undefined,
      registryVersion: '1',
      restoreState:    CheckpointRestoreAdapter.wrap(
        (snapshot: JsonObjectType) => ScrapeState.restore(snapshot),
      ),
    };
    return registryBundle;
  },
};

export default registry;
