import { mkdir, appendFile } from 'node:fs/promises';
import { dirname, join }     from 'node:path';

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import { Logger }           from '../modules/logger/logger.js';
import type { ScrapeState } from '../state/ScrapeState.js';
import type { RipperServices } from '../services/RipperServices.js';

const logger = Logger.forComponent('JsonlAppendNode');

type JsonlAppendOutput = 'success' | 'skipped';

/**
 * Appends `JSON.stringify(state.output) + '\n'` to `<outDir>/<targetId>/<pluginTaskName>/all.jsonl`.
 *
 * When `services.pluginTaskName` is set the file is appended under a per-plugin subfolder.
 * When absent it appends to `<outDir>/<targetId>/all.jsonl`.
 * The `_raw` field is never embedded.
 *
 * Output ports:
 * - `success` — row appended.
 * - `skipped` — `state.output` is `null`; nothing written.
 *
 * @category Nodes
 * @since 3.0.0
 */
class JsonlAppendNodeImpl extends ScalarNode<ScrapeState, JsonlAppendOutput, RipperServices> {
  public readonly name = 'jsonl:append';
  public readonly outputs = ['success', 'skipped'] as const;

  protected override async executeOne(
    state:   ScrapeState,
    context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<JsonlAppendOutput>> {
    const { services } = context;
    if (state.output === null) {
      logger.debug('jsonl:append', 'Skipping append — state.output is null', { task: 'jsonl:append' });
      return NodeOutputBuilder.of('skipped');
    }
    const splitByTaskName = services.splitByTaskName !== false;
    const subdir          = (services.pluginTaskName !== undefined && splitByTaskName)
      ? services.pluginTaskName
      : '';
    const outFile = subdir.length > 0
      ? join(services.outDir, services.target.id, subdir, 'all.jsonl')
      : join(services.outDir, services.target.id, 'all.jsonl');
    await mkdir(dirname(outFile), { recursive: true });
    // _raw is NOT embedded — it lives in the sibling raw/ folder.
    const payload: Record<string, unknown> = { ...state.output };
    await appendFile(outFile, `${JSON.stringify(payload)}\n`, 'utf8');
    logger.debug('jsonl:append', `Appended JSONL row: ${outFile}`, { task: 'jsonl:append', outFile });
    return NodeOutputBuilder.of('success');
  }
}

export const JsonlAppendNode = new JsonlAppendNodeImpl();
