import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join }    from 'node:path';

import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import { Logger }           from '../modules/logger/logger.js';
import { pageSlug }         from './fileUtils.js';
import type { ScrapeState } from '../state/ScrapeState.js';
import type { RipperServices } from '../services/RipperServices.js';

const logger = Logger.forComponent('JsonWriteNode');

/**
 * Writes `state.output` as 2-space JSON to `<outDir>/<targetId>/<pluginTaskName>/<slug>.json`.
 *
 * When `services.pluginTaskName` is set the file goes under a per-plugin subfolder.
 * When absent the file is written directly under `<outDir>/<targetId>/`.
 * The `_raw` field is never embedded; raw content lives in the sibling `raw/` folder.
 *
 * Output ports:
 * - `success` — file written.
 * - `skipped` — `state.output` is `null`; nothing written.
 *
 * @category Nodes
 * @since 3.0.0
 */
export const JsonWriteNode: NodeInterface<ScrapeState, 'success' | 'skipped', RipperServices> = {
  name: 'json:write',
  outputs: ['success', 'skipped'],

  async execute(state: ScrapeState, context: NodeContextInterface<RipperServices>): Promise<{ output: 'success' | 'skipped' }> {
    const { services } = context;
    if (state.output === null) {
      logger.debug('json:write', 'Skipping write — state.output is null', { task: 'json:write' });
      return { output: 'skipped' };
    }
    const slug            = pageSlug(state.page);
    const splitByTaskName = services.splitByTaskName !== false;
    const subdir          = (services.pluginTaskName !== undefined && splitByTaskName)
      ? services.pluginTaskName
      : '';
    const outFile = subdir.length > 0
      ? join(services.outDir, services.target.id, subdir, `${slug}.json`)
      : join(services.outDir, services.target.id, `${slug}.json`);
    await mkdir(dirname(outFile), { recursive: true });
    // _raw is NOT embedded — it lives in the sibling raw/ folder.
    const payload: Record<string, unknown> = { ...state.output };
    await writeFile(outFile, JSON.stringify(payload, null, 2), 'utf8');
    logger.debug('json:write', `Wrote JSON: ${outFile}`, { task: 'json:write', outFile });
    return { output: 'success' };
  },
};

/** OperationContract for JsonWriteNode: reads output, writes to disk (no state field). */
export const jsonWriteContract: OperationContract = {
  name:         'json:write',
  hardRequired: ['output'],
  produces:     [],
  outputs:      ['success', 'skipped'],
};
