/**
 * Monster concept — base slice extraction.
 *
 * Exports: resolveMonsterSpan, getMonsterHeadHtml, computeDisplayTraits,
 * extractMonsterBase, monsterBaseNode.
 */
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
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
function extractCreatureArt(root: CheerioAPI): string | null {
  const href = root('a.monster-art-link').first().attr('href');
  return href !== undefined && href !== '' ? href : null;
}

/** Extract the monster flavor/lore text from the `<span class="hide-on-print">` block. */
function extractFlavorText(root: CheerioAPI): string | null {
  let result: string | null = null;
  root('span.hide-on-print').each((_index, element) => {
    const $el = root(element);
    const h1El = $el.find('h1.title');
    if (h1El.length === 0) return;
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
  const regex = /<b>\s*(?:<[^>]+>)*\s*Recall Knowledge\s*(?:<\/[^>]+>)*\s*<\/b>([\s\S]*?)(?=<b>|<br|$)/i;
  const match = regex.exec(headHtml);
  if (match === null) return null;
  const raw = htmlToText(match[1] ?? '').trim();
  return raw !== '' ? raw : null;
}

/**
 * Resolve the canonical monster-page content span. AON wraps the statblock in
 * `<span class="monster-page">`, but `parseAonHtml` may pass a narrower
 * `hide-on-print` span; we prefer the structured span when present.
 */
export function resolveMonsterSpan(root: CheerioAPI, span: CheerioNode): CheerioNode {
  const direct = root('span.monster-page').first();
  return direct.length > 0 ? direct : span;
}

/**
 * Extract the head-of-statblock HTML fragment (everything before the first
 * `<hr/>` boundary) from the resolved monster span.
 */
export function getMonsterHeadHtml(root: CheerioAPI, span: CheerioNode): string {
  const pageSpan = resolveMonsterSpan(root, span);
  const spanHtml = pageSpan.html() ?? '';
  return spanHtml.split(/<hr\s*\/?>/i)[0] ?? '';
}

/** Compute the filtered display-trait list (rarity/size/alignment stripped). */
export function computeDisplayTraits(common: CommonExtraction): string[] {
  const rarity = common.traits.rarity;
  const filterTraits = new Set<string>([
    common.traits.size ?? '',
    common.traits.alignment ?? '',
    rarity.charAt(0).toUpperCase() + rarity.slice(1),
  ]);
  return common.traits.traits.filter((trimmed) => !filterTraits.has(trimmed));
}

/** Extract base identity + skill/attribute fields. */
export function extractMonsterBase(common: CommonExtraction, root: CheerioAPI, span: CheerioNode): MonsterBaseSlice {
  const headHtml = getMonsterHeadHtml(root, span);
  const rkRaw = getField(common, 'Recall Knowledge') ?? extractRecallKnowledgeFromHead(headHtml);

  return {
    url:              common.url,
    monster_id:       extractEntityId(common.url),
    name:             common.title.name,
    level:            common.title.level,
    rarity:           common.traits.rarity,
    size:             common.traits.size,
    alignment:        common.traits.alignment,
    traits:           computeDisplayTraits(common),
    trait_ids:        common.traits.trait_ids,
    source:           { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:          common.sources,
    alt_edition_url:  common.title.alt_edition_url,
    pfs:              common.title.pfs,
    is_legacy:        common.title.legacy,
    creature_art:     extractCreatureArt(root),
    flavor_text:      extractFlavorText(root),
    recall_knowledge: parseRecallKnowledge(rkRaw),
    perception:       parsePerception(getField(common, 'Perception')),
    languages:        parseLanguages(getField(common, 'Languages')),
    skills:           parseSkills(getField(common, 'Skills')),
    abilities:        parseAbilityScores(common),
    items:            parseItems(getField(common, 'Items')),
  };
}

export type MonsterBaseOutput = 'success' | 'error';

class MonsterBaseNode extends ScalarNode<ScrapeState, MonsterBaseOutput> {
  public readonly name = 'extract:monster-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<MonsterBaseOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('error');

    const base = extractMonsterBase(common, root, target);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const monsterBaseNode = new MonsterBaseNode();
