import { readFile }        from 'node:fs/promises';
import { resolve }          from 'node:path';
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import type { CategoryMemberInterface } from '../../types/MediaWikiScraper.js';
import type { FailuresManifestInterface } from '../../types/RipperRun.js';
import { toNodeError }                   from '../fileUtils.js';
import type { MemberResolutionState }    from '../../state/MemberResolutionState.js';
import type { RipperServices }              from '../../services/RipperServices.js';

/**
 * Reads titles from `<outDir>/<target>/failures.json` and writes them as
 * synthetic `CategoryMemberInterface` entries (pageid 0) into `state.members`.
 *
 * Output ports:
 * - `success` — failures manifest read; `state.members` populated.
 * - `error`   — file missing, unreadable, or malformed; error collected.
 *
 * @category Nodes
 * @since 3.0.0
 */
export const ResumeFailuresNode: NodeInterface<
  MemberResolutionState,
  'success' | 'error',
  RipperServices
> = {
  name: 'wiki:resume-failures',
  outputs: ['success', 'error'],

  async execute(
    state:   MemberResolutionState,
    context: NodeContextInterface<RipperServices>,
  ): Promise<{ output: 'success' | 'error' }> {
    const { services } = context;
    const failuresPath = resolve(services.outDir, state.target, 'failures.json');

    let manifest: FailuresManifestInterface;
    try {
      const raw = await readFile(failuresPath, 'utf-8');
      manifest  = JSON.parse(raw) as FailuresManifestInterface;
    } catch (err) {
      state.collectError(toNodeError(err, 'wiki:resume-failures'));
      return { output: 'error' };
    }

    state.members = manifest.titles.map((title: string): CategoryMemberInterface => ({ title, pageid: 0 }));
    services.log.info('wiki:resume-failures', `Mode: resume-failures — ${state.members.length.toString()} pages from failures.json`);
    return { output: 'success' };
  },
};

/** OperationContract for ResumeFailuresNode: produces members from failures.json. */
export const resumeFailuresContract: OperationContract = {
  name:         'wiki:resume-failures',
  hardRequired: [],
  produces:     ['members'],
  outputs:      ['success', 'error'],
};
