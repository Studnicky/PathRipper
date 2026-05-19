import { readFile } from 'node:fs/promises';

import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import type { ConfigLoadState } from '../../state/ConfigLoadState.js';
import { toNodeError } from '../fileUtils.js';

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
export const ReadFileNode: NodeInterface<ConfigLoadState, 'success' | 'not-found' | 'error'> = {
  name: 'config:read-file',
  outputs: ['success', 'not-found', 'error'],

  async execute(
    state: ConfigLoadState,
    _context: NodeContextInterface<undefined>,
  ): Promise<{ output: 'success' | 'not-found' | 'error' }> {
    try {
      state.raw = await readFile(state.path, 'utf-8');
      return { output: 'success' };
    } catch (err: unknown) {
      const isEnoent =
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: string }).code === 'ENOENT';

      state.collectError(toNodeError(err, 'config:read-file'));
      return { output: isEnoent ? 'not-found' : 'error' };
    }
  },
};

/** OperationContract for ReadFileNode: reads path, produces raw. */
export const readFileContract: OperationContract = {
  name:         'config:read-file',
  hardRequired: ['path'],
  produces:     ['raw'],
  outputs:      ['success', 'not-found', 'error'],
};
