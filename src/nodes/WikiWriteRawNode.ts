import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join }    from 'node:path';

import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import { ExternalSchemaError } from '../errors/ExternalSchemaError.js';
import { Logger }               from '../modules/logger/logger.js';
import { pageSlug }             from './fileUtils.js';
import type { ScrapeState }     from '../state/ScrapeState.js';
import type { RipperServices }     from '../services/RipperServices.js';

const logger = Logger.forComponent('WikiWriteRawNode');

/**
 * Writes `state.page.wikitext` to `<outDir>/<targetId>/raw/<slug>.txt`.
 *
 * Output ports:
 * - `success` — file written successfully.
 *
 * @category Nodes
 * @since 3.0.0
 */
export const WikiWriteRawNode: NodeInterface<ScrapeState, 'success', RipperServices> = {
  name: 'wiki:write-raw',
  outputs: ['success'],

  async execute(state: ScrapeState, context: NodeContextInterface<RipperServices>): Promise<{ output: 'success' }> {
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
    logger.debug('wiki:write-raw', `Wrote raw wikitext: ${outFile}`, { task: 'wiki:write-raw', outFile });
    return { output: 'success' };
  },
};

/** OperationContract for WikiWriteRawNode: reads page.wikitext, writes to disk (no state field). */
export const wikiWriteRawContract: OperationContract = {
  name:         'wiki:write-raw',
  hardRequired: ['page.wikitext'],
  produces:     [],
  outputs:      ['success'],
};
