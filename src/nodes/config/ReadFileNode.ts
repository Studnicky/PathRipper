import { readFile } from 'node:fs/promises';

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import type { ConfigLoadState } from '../../state/ConfigLoadState.js';
import { toNodeError } from '../fileUtils.js';

type ReadFileOutput = 'success' | 'not-found' | 'error';

/**
 * Reads the config file at `state.path` and stores the raw content in `state.raw`.
 *
 * Output ports:
 * - `success`   — file read successfully; `state.raw` is populated.
 * - `not-found` — no file at `state.path` (ENOENT); error recorded on state.
 * - `error`     — other IO failure; error recorded on state.
 *
 * @category Nodes
 * @since 3.0.0
 */
class ReadFileNodeImpl extends ScalarNode<ConfigLoadState, ReadFileOutput, undefined> {
  public readonly name = 'config:read-file';
  public readonly outputs = ['success', 'not-found', 'error'] as const;

  protected override async executeOne(
    state: ConfigLoadState,
    _context: NodeContextType<undefined>,
  ): Promise<NodeOutputType<ReadFileOutput>> {
    try {
      state.raw = await readFile(state.path, 'utf-8');
      return NodeOutputBuilder.of('success');
    } catch (err: unknown) {
      const isEnoent =
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: string }).code === 'ENOENT';

      state.collectError(toNodeError(err, 'config:read-file'));
      return NodeOutputBuilder.of(isEnoent ? 'not-found' : 'error');
    }
  }
}

export const ReadFileNode = new ReadFileNodeImpl();
