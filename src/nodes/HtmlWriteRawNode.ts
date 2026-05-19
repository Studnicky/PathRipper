import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join }    from 'node:path';

import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import { ExternalSchemaError } from '../errors/ExternalSchemaError.js';
import { Logger }               from '../modules/logger/logger.js';
import { pageSlug }             from './fileUtils.js';
import type { ScrapeState }     from '../state/ScrapeState.js';
import type { RipperServices }     from '../services/RipperServices.js';

const logger = Logger.forComponent('HtmlWriteRawNode');

/**
 * Writes `state.page.html` to `<outDir>/<targetId>/raw/<slug>.html`.
 *
 * Output ports:
 * - `success` — file written successfully.
 *
 * @category Nodes
 * @since 3.0.0
 */
export const HtmlWriteRawNode: NodeInterface<ScrapeState, 'success', RipperServices> = {
  name: 'html:write-raw',
  outputs: ['success'],

  async execute(state: ScrapeState, context: NodeContextInterface<RipperServices>): Promise<{ output: 'success' }> {
    const { services } = context;
    const html = state.page.html;
    if (html === undefined || html.length === 0) {
      throw ExternalSchemaError.create('html:write-raw requires state.page.html to be set', {
        metadata: { task: 'html:write-raw', targetId: services.target.id },
      });
    }
    const slug    = pageSlug(state.page);
    const outFile = join(services.outDir, services.target.id, 'raw', `${slug}.html`);
    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, html, 'utf8');
    logger.debug('html:write-raw', `Wrote raw HTML: ${outFile}`, { task: 'html:write-raw', outFile });
    return { output: 'success' };
  },
};

/** OperationContract for HtmlWriteRawNode: reads page.html, writes to disk (no state field). */
export const htmlWriteRawContract: OperationContract = {
  name:         'html:write-raw',
  hardRequired: ['page.html'],
  produces:     [],
  outputs:      ['success'],
};
