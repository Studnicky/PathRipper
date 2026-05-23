/**
 * Monster concept — meta slice extraction.
 *
 * Exports: parseFamilyLinks, extractVariants, extractMonsterMeta, monsterMetaNode.
 */
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import type { MonsterMetaSlice, MonsterOutput } from './types.js';

/**
 * Extract family group links from `c.links` (which is harvested from the full
 * content span by common.ts, covering both the head and the post-stat-block
 * "Related Groups" section). Deduplicates by name.
 */
export function parseFamilyLinks(c: CommonExtraction): Array<{ name: string; family_id: number | null }> {
  const out: Array<{ name: string; family_id: number | null }> = [];
  const seen = new Set<string>();
  for (const link of c.links) {
    if (link.kind !== 'MonsterFamilies') continue;
    if (link.text === '' || seen.has(link.text)) continue;
    seen.add(link.text);
    out.push({ name: link.text, family_id: link.id });
  }
  return out;
}

/** Pull Elite/Normal/Weak/PWL sibling URLs from the variant nav. */
export function extractVariants($: CheerioAPI, span: CheerioNode): MonsterOutput['variants'] {
  const out: MonsterOutput['variants'] = [];
  span.find('h2.hide-on-print a').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') ?? '';
    if (href === '') return;
    const text = $a.text().trim().toLowerCase();
    const kind = text === 'elite' ? 'elite' : text === 'normal' ? 'normal' : text === 'weak' ? 'weak' : null;
    if (kind !== null) out.push({ kind, url: href });
  });
  span.find('a.monster-pwl-link').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (href !== '') out.push({ kind: 'pwl', url: href });
  });
  return out;
}

/** Extract meta slice (variants + family links). */
export function extractMonsterMeta(c: CommonExtraction, $: CheerioAPI, span: CheerioNode): MonsterMetaSlice {
  return {
    variants:     extractVariants($, span),
    family_links: parseFamilyLinks(c),
  };
}

export type MonsterMetaOutput = 'success' | 'error';

export const monsterMetaNode: NodeInterface<ScrapeState, MonsterMetaOutput, RipperServices> = {
  name:    'extract:monster-meta',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: MonsterMetaOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'error' };

    const meta = extractMonsterMeta(c, $, target);

    state.output = { ...state.output, ...meta };

    return { output: 'success' };
  },
};
