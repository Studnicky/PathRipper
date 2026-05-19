/**
 * cliScrapeFlow — contract-derived CLI scrape flow.
 *
 * Uses FlowDeriver with `annotations.terminals` for all non-`success` output
 * ports. FlowDeriver is sufficient here because:
 *
 *   - The data graph provides a linear chain: `load-config → resolve-target`
 *     (via `configPath → config → targetKind`) and dispatch-to-write-manifest
 *     chain (via `failedCount`).
 *   - `resolve-target` emits `html`/`wiki`/`not-found` instead of `success`.
 *     These are declared as `terminals` with non-null targets for `html`/`wiki`
 *     (re-routing to the correct dispatch node) and `null` for `not-found`.
 *   - Both dispatch nodes (`dispatch-html-scrape`, `dispatch-wiki-scrape`) share
 *     the same `hardRequired` fields (`config`, `targetId`), so they appear at
 *     the same data-graph depth. FlowDeriver places them in a `ParallelNode`
 *     description, but the cursor-based runtime never reaches that group —
 *     `resolve-target`'s `terminals` route directly to the appropriate
 *     `SingleNode` placement, bypassing the parallel wrapper entirely.
 *   - `write-manifest` has no data-graph successors (produces nothing). Both its
 *     output ports (`success`, `skipped`) are declared in `terminals` to route
 *     to `cli:exit`.
 *
 * Flow shape:
 *   load-config → resolve-target → {
 *     html      → dispatch-html-scrape → write-manifest → exit
 *     wiki      → dispatch-wiki-scrape → write-manifest → exit
 *     not-found → exit
 *   }
 *   load-config/error → exit
 */

import { FlowDeriver }       from '@noocodex/dagonizer/derive';
import type { DAG }           from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import { loadConfigContract }          from '../nodes/cli/LoadConfigNode.js';
import { resolveTargetContract }       from '../nodes/cli/ResolveTargetNode.js';
import { dispatchHtmlScrapeContract }  from '../nodes/cli/DispatchHtmlScrapeNode.js';
import { dispatchWikiScrapeContract }  from '../nodes/cli/DispatchWikiScrapeNode.js';
import { writeManifestContract }       from '../nodes/cli/WriteManifestNode.js';
import { exitNodeContract }            from '../nodes/cli/ExitNode.js';

/**
 * Canonical DAG name for the CLI scrape flow.
 * @category Flows
 * @since 4.0.0
 */
export const CLI_SCRAPE_FLOW = 'cliScrapeDAG';

const cliContracts: readonly OperationContract[] = [
  loadConfigContract,
  resolveTargetContract,
  dispatchHtmlScrapeContract,
  dispatchWikiScrapeContract,
  writeManifestContract,
  exitNodeContract,
];

/**
 * Contract-derived CLI scrape flow.
 *
 * @category Flows
 * @since 4.0.0
 */
export const cliScrapeFlow: DAG = FlowDeriver.derive({
  name:       CLI_SCRAPE_FLOW,
  version:    '2.0',
  entrypoint: 'cli:load-config',
  contracts:  cliContracts,
  annotations: {
    terminals: {
      // load-config emits success (auto-wired to resolve-target) or error.
      'cli:load-config': [
        { outcome: 'error', target: 'cli:exit' },
      ],
      // resolve-target emits html/wiki/not-found (no 'success' port).
      // html/wiki re-route to the corresponding dispatch node;
      // not-found terminates at exit.
      'cli:resolve-target': [
        { outcome: 'html',      target: 'cli:dispatch-html-scrape' },
        { outcome: 'wiki',      target: 'cli:dispatch-wiki-scrape' },
        { outcome: 'not-found', target: 'cli:exit' },
      ],
      // dispatch nodes: success auto-wires to write-manifest (first successor);
      // partial and error also route to write-manifest.
      'cli:dispatch-html-scrape': [
        { outcome: 'partial', target: 'cli:write-manifest' },
        { outcome: 'error',   target: 'cli:write-manifest' },
      ],
      'cli:dispatch-wiki-scrape': [
        { outcome: 'partial', target: 'cli:write-manifest' },
        { outcome: 'error',   target: 'cli:write-manifest' },
      ],
      // write-manifest has no data-graph successors; both ports route to exit.
      'cli:write-manifest': [
        { outcome: 'success', target: 'cli:exit' },
        { outcome: 'skipped', target: 'cli:exit' },
      ],
    },
  },
});
