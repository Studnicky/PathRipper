import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join }    from 'node:path';

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import { ExternalSchemaError } from '../errors/ExternalSchemaError.js';
import { Logger }               from '../modules/logger/logger.js';
import { pageSlug }             from './fileUtils.js';
import type { ScrapeState }     from '../state/ScrapeState.js';
import type { RipperServices }  from '../services/RipperServices.js';

const log = Logger.forComponent('WikiWriteRawNode');

type WikiWriteRawOutput = 'success';

/**
 * Writes `state.page.wikitext` to `<outDir>/<targetId>/raw/<slug>.txt`.
 *
 * Output ports:
 * - `success` — file written successfully.
 *
 * @category Nodes
 * @since 3.0.0
 */
class WikiWriteRawNodeImpl extends ScalarNode<ScrapeState, WikiWriteRawOutput, RipperServices> {
  public readonly name = 'wiki:write-raw';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state:   ScrapeState,
    context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<WikiWriteRawOutput>> {
    const { services } = context;
    const wikitext = state.page.wikitext;
    if (wikitext === undefined || wikitext.length === 0) {
      throw ExternalSchemaError.create('wiki:write-raw requires state.page.wikitext to be set', {
        metadata: { task: 'wiki:write-raw', targetId: services.target.id },
      });
    }
    const slug    = pageSlug(state.page);
    const outFile = join(services.outDir, services.target.id, 'raw', `${slug}.txt`);
    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, wikitext, 'utf8');
    log.debug('wiki:write-raw', `Wrote raw wikitext: ${outFile}`, { task: 'wiki:write-raw', outFile });
    return NodeOutputBuilder.of('success');
  }
}

export const WikiWriteRawNode = new WikiWriteRawNodeImpl();
