/**
 * Monster concept — base slice extraction.
 *
 * Exports: resolveMonsterSpan, getMonsterHeadHtml, computeDisplayTraits,
 * extractMonsterBase, monsterBaseNode.
 */
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import {
  getField,
  extractEntityId,
  htmlToText,
} from '../../common.js';
import type { MonsterBaseSlice } from './types.js';
import {
  parseRecallKnowledge,
  parsePerception,
  parseLanguages,
  parseSkills,
  parseItems,
} from './helpers.js';
import { parseAbilityScores } from '../../capabilities/abilityScores.js';

/** Extract the creature illustration URL from `<a class="monster-art-link" href="…">`. */
function extractCreatureArt($: CheerioAPI): string | null {
  const href = $('a.monster-art-link').first().attr('href');
  return href !== undefined && href !== '' ? href : null;
}

/** Extract the monster flavor/lore text from the `<span class="hide-on-print">` block. */
function extractFlavorText($: CheerioAPI): string | null {
  let result: string | null = null;
  $('span.hide-on-print').each((_, el) => {
    const $el = $(el);
    const h1 = $el.find('h1.title');
    if (h1.length === 0) return;
    const clone = $el.clone();
    clone.find('h1.title').remove();
    const text = clone.text().replace(/\s+/g, ' ').trim();
    if (text !== '') { result = text; return false; }
    return undefined;
  });
  return result;
}

/** Extract Recall Knowledge from the head HTML. */
function extractRecallKnowledgeFromHead(headHtml: string): string | null {
  const re = /<b>\s*(?:<[^>]+>)*\s*Recall Knowledge\s*(?:<\/[^>]+>)*\s*<\/b>([\s\S]*?)(?=<b>|<br|$)/i;
  const m = re.exec(headHtml);
  if (m === null) return null;
  const raw = htmlToText(m[1] ?? '').trim();
  return raw !== '' ? raw : null;
}

/**
 * Resolve the canonical monster-page content span. AON wraps the statblock in
 * `<span class="monster-page">`, but `parseAonHtml` may pass a narrower
 * `hide-on-print` span; we prefer the structured span when present.
 */
export function resolveMonsterSpan($: CheerioAPI, span: CheerioNode): CheerioNode {
  const direct = $('span.monster-page').first();
  return direct.length > 0 ? direct : span;
}

/**
 * Extract the head-of-statblock HTML fragment (everything before the first
 * `<hr/>` boundary) from the resolved monster span.
 */
export function getMonsterHeadHtml($: CheerioAPI, span: CheerioNode): string {
  const pageSpan = resolveMonsterSpan($, span);
  const spanHtml = pageSpan.html() ?? '';
  return spanHtml.split(/<hr\s*\/?>/i)[0] ?? '';
}

/** Compute the filtered display-trait list (rarity/size/alignment stripped). */
export function computeDisplayTraits(c: CommonExtraction): string[] {
  const rarity = c.traits.rarity;
  const filterTraits = new Set<string>([
    c.traits.size ?? '',
    c.traits.alignment ?? '',
    rarity.charAt(0).toUpperCase() + rarity.slice(1),
  ]);
  return c.traits.traits.filter((t) => !filterTraits.has(t));
}

/** Extract base identity + skill/attribute fields. */
export function extractMonsterBase(c: CommonExtraction, $: CheerioAPI, span: CheerioNode): MonsterBaseSlice {
  const headHtml = getMonsterHeadHtml($, span);
  const rkRaw = getField(c, 'Recall Knowledge') ?? extractRecallKnowledgeFromHead(headHtml);

  return {
    _type:            'monster',
    url:              c.url,
    monster_id:       extractEntityId(c.url),
    name:             c.title.name,
    level:            c.title.level,
    rarity:           c.traits.rarity,
    size:             c.traits.size,
    alignment:        c.traits.alignment,
    traits:           computeDisplayTraits(c),
    trait_ids:        c.traits.trait_ids,
    source:           { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:          c.sources,
    alt_edition_url:  c.title.alt_edition_url,
    pfs:              c.title.pfs,
    is_legacy:        c.title.legacy,
    creature_art:     extractCreatureArt($),
    flavor_text:      extractFlavorText($),
    recall_knowledge: parseRecallKnowledge(rkRaw),
    perception:       parsePerception(getField(c, 'Perception')),
    languages:        parseLanguages(getField(c, 'Languages')),
    skills:           parseSkills(getField(c, 'Skills')),
    abilities:        parseAbilityScores(c),
    items:            parseItems(getField(c, 'Items')),
  };
}

export type MonsterBaseOutput = 'success' | 'error';

export const monsterBaseNode: NodeInterface<ScrapeState, MonsterBaseOutput, RipperServices> = {
  name:    'extract:monster-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: MonsterBaseOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'error' };

    const base = extractMonsterBase(c, $, target);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};
