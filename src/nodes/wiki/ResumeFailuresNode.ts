import { readFile }   from 'node:fs/promises';
import { resolve }    from 'node:path';

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import type { CategoryMemberType }  from '../../types/MediaWikiScraper.js';
import type { FailuresManifestType } from '../../types/RipperRun.js';
import { toNodeError }                   from '../fileUtils.js';
import type { MemberResolutionState }    from '../../state/MemberResolutionState.js';
import type { RipperServices }           from '../../services/RipperServices.js';

type ResumeFailuresOutput = 'success' | 'error';

/**
 * Reads titles from `<outDir>/<target>/failures.json` and writes them as
 * synthetic `CategoryMemberType` entries (pageid 0) into `state.members`.
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

  public override get outputSchema(): Record<ResumeFailuresOutput, SchemaObjectType> {
    return {
      // `success` — `state.members` populated from failures.json as synthetic CategoryMemberType entries (pageid 0).
      success: {
        type: 'object',
        properties: {
          members: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title:  { type: 'string' },
                pageid: { type: 'integer' },
              },
              required: ['title', 'pageid'],
            },
          },
        },
        required: ['members'],
      },
      // `error` — failures.json missing, unreadable, or malformed; error recorded on state; no state delta.
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state:   MemberResolutionState,
    context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<ResumeFailuresOutput>> {
    const { services } = context;
    const failuresPath = resolve(services.outDir, state.target, 'failures.json');

    let manifest: FailuresManifestType;
    try {
      const raw = await readFile(failuresPath, 'utf-8');
      manifest  = JSON.parse(raw) as FailuresManifestType;
    } catch (err) {
      state.collectError(toNodeError(err, 'wiki:resume-failures'));
      return NodeOutputBuilder.of('error');
    }

    state.members = manifest.titles.map((title: string): CategoryMemberType => ({ title, pageid: 0 }));
    services.log.info('wiki:resume-failures', `Mode: resume-failures — ${state.members.length.toString()} pages from failures.json`);
    return NodeOutputBuilder.of('success');
  }
}

export const ResumeFailuresNode = new ResumeFailuresNodeImpl();
