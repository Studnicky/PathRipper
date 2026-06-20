/**
 * cliScrapeFlow — DAGBuilder-native CLI scrape flow.
 *
 * Flow shape:
 *   load-config → resolve-target → {
 *     html      → dispatch-html-scrape → write-manifest → exit
 *     wiki      → dispatch-wiki-scrape → write-manifest → exit
 *     not-found → exit
 *   }
 *   load-config/error → exit
 *   exit/success      → cli:completed (terminal)
 */

import { DAGBuilder } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';

import { LoadConfigNode }          from '../nodes/cli/LoadConfigNode.js';
import { ResolveTargetNode }       from '../nodes/cli/ResolveTargetNode.js';
import { DispatchHtmlScrapeNode }  from '../nodes/cli/DispatchHtmlScrapeNode.js';
import { DispatchWikiScrapeNode }  from '../nodes/cli/DispatchWikiScrapeNode.js';
import { WriteManifestNode }       from '../nodes/cli/WriteManifestNode.js';
import { ExitNode }                from '../nodes/cli/ExitNode.js';

/**
 * Canonical DAG name for the CLI scrape flow.
 * @category Flows
 * @since 4.0.0
 */
export const CLI_SCRAPE_FLOW = 'cliScrapeDAG';

/**
 * DAGBuilder-native CLI scrape flow.
 *
 * @category Flows
 * @since 4.0.0
 */
export const cliScrapeFlow: DAGType = new DAGBuilder(CLI_SCRAPE_FLOW, '2.0')
  .node('cli:load-config',           LoadConfigNode,          { success: 'cli:resolve-target',       error:   'cli:exit'            })
  .node('cli:resolve-target',        ResolveTargetNode,       { html:    'cli:dispatch-html-scrape', wiki:    'cli:dispatch-wiki-scrape', 'not-found': 'cli:exit' })
  .node('cli:dispatch-html-scrape',  DispatchHtmlScrapeNode,  { success: 'cli:write-manifest',       partial: 'cli:write-manifest', error:   'cli:write-manifest' })
  .node('cli:dispatch-wiki-scrape',  DispatchWikiScrapeNode,  { success: 'cli:write-manifest',       partial: 'cli:write-manifest', error:   'cli:write-manifest' })
  .node('cli:write-manifest',        WriteManifestNode,       { success: 'cli:exit',                 skipped: 'cli:exit'            })
  .node('cli:exit',                  ExitNode,                { success: 'cli:completed'             })
  .terminal('cli:completed', { outcome: 'completed' })
  .build();
