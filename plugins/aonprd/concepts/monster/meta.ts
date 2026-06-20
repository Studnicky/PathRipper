/**
 * Monster concept — meta slice extraction.
 *
 * Exports: parseFamilyLinks, extractVariants, extractMonsterMeta, monsterMetaNode.
 */
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import type { MonsterMetaSlice, MonsterOutput } from './types.js';

/**
 * Extract family group links from `c.links` (which is harvested from the full
 * content span by common.ts, covering both the head and the post-stat-block
 * "Related Groups" section). Deduplicates by name.
 */
export function parseFamilyLinks(common: CommonExtraction): Array<{ name: string; family_id: number | null }> {
  const out: Array<{ name: string; family_id: number | null }> = [];
  const seen = new Set<string>();
  for (const link of common.links) {
    if (link.kind !== 'MonsterFamilies') continue;
    if (link.text === '' || seen.has(link.text)) continue;
    seen.add(link.text);
    out.push({ name: link.text, family_id: link.id });
  }
  return out;
}

/** Pull Elite/Normal/Weak/PWL sibling URLs from the variant nav. */
export function extractVariants(root: CheerioAPI, span: CheerioNode): MonsterOutput['variants'] {
  const out: MonsterOutput['variants'] = [];
  span.find('h2.hide-on-print a').each((_index, element) => {
    const $anchor = root(element);
    const href = $anchor.attr('href') ?? '';
    if (href === '') return;
    const text = $anchor.text().trim().toLowerCase();
    const kind = text === 'elite' ? 'elite' : text === 'normal' ? 'normal' : text === 'weak' ? 'weak' : null;
    if (kind !== null) out.push({ kind, url: href });
  });
  span.find('a.monster-pwl-link').each((_index, element) => {
    const href = root(element).attr('href') ?? '';
    if (href !== '') out.push({ kind: 'pwl', url: href });
  });
  return out;
}

/** Extract meta slice (variants + family links). */
export function extractMonsterMeta(common: CommonExtraction, root: CheerioAPI, span: CheerioNode): MonsterMetaSlice {
  return {
    variants:     extractVariants(root, span),
    family_links: parseFamilyLinks(common),
  };
}

export type MonsterMetaOutput = 'success' | 'error';

class MonsterMetaNode extends ScalarNode<ScrapeState, MonsterMetaOutput> {
  public readonly name = 'extract:monster-meta';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<MonsterMetaOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('error');

    const meta = extractMonsterMeta(common, root, target);

    state.output = { ...state.output, ...meta };

    return NodeOutputBuilder.of('success');
  }
}

export const monsterMetaNode = new MonsterMetaNode();
