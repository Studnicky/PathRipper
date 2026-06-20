import { readFile }   from 'node:fs/promises';
import { resolve }    from 'node:path';

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import type { CategoryMemberInterface }  from '../../types/MediaWikiScraper.js';
import type { FailuresManifestInterface } from '../../types/RipperRun.js';
import { toNodeError }                   from '../fileUtils.js';
import type { MemberResolutionState }    from '../../state/MemberResolutionState.js';
import type { RipperServices }           from '../../services/RipperServices.js';

type ResumeFailuresOutput = 'success' | 'error';

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
class ResumeFailuresNodeImpl extends ScalarNode<MemberResolutionState, ResumeFailuresOutput, RipperServices> {
  public readonly name = 'wiki:resume-failures';
  public readonly outputs = ['success', 'error'] as const;

  protected override async executeOne(
    state:   MemberResolutionState,
    context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<ResumeFailuresOutput>> {
    const { services } = context;
    const failuresPath = resolve(services.outDir, state.target, 'failures.json');

    let manifest: FailuresManifestInterface;
    try {
      const raw = await readFile(failuresPath, 'utf-8');
      manifest  = JSON.parse(raw) as FailuresManifestInterface;
    } catch (err) {
      state.collectError(toNodeError(err, 'wiki:resume-failures'));
      return NodeOutputBuilder.of('error');
    }

    state.members = manifest.titles.map((title: string): CategoryMemberInterface => ({ title, pageid: 0 }));
    services.log.info('wiki:resume-failures', `Mode: resume-failures — ${state.members.length.toString()} pages from failures.json`);
    return NodeOutputBuilder.of('success');
  }
}

export const ResumeFailuresNode = new ResumeFailuresNodeImpl();
