import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join }    from 'node:path';

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import { Logger }           from '../modules/logger/logger.js';
import { pageSlug }         from './fileUtils.js';
import type { ScrapeState } from '../state/ScrapeState.js';
import type { RipperServices } from '../services/RipperServices.js';

const log = Logger.forComponent('JsonWriteNode');

type JsonWriteOutput = 'success' | 'skipped';

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
class JsonWriteNodeImpl extends ScalarNode<ScrapeState, JsonWriteOutput, RipperServices> {
  public readonly name = 'json:write';
  public readonly outputs = ['success', 'skipped'] as const;

  public override get outputSchema(): Record<JsonWriteOutput, SchemaObjectType> {
    return {
      // `success` — JSON file written to disk; no state delta.
      success: { type: 'object' },
      // `skipped` — `state.output` was null; no write performed; no state delta.
      skipped: { type: 'object' },
    };
  }

  protected override async executeOne(
    state:   ScrapeState,
    context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<JsonWriteOutput>> {
    const { services } = context;
    if (state.output === null) {
      log.debug('json:write', 'Skipping write — state.output is null', { task: 'json:write' });
      return NodeOutputBuilder.of('skipped');
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
    log.debug('json:write', `Wrote JSON: ${outFile}`, { task: 'json:write', outFile });
    return NodeOutputBuilder.of('success');
  }
}

export const JsonWriteNode = new JsonWriteNodeImpl();
