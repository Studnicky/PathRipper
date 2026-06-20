/**
 * Monster concept — abilities slice extraction.
 *
 * Exports: isAbilityName, isVariantOverlayJunk, parseBareBoldAbilities,
 * extractMonsterAbilities, monsterAbilitiesNode.
 */
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import { load, type CheerioAPI } from 'cheerio';
import type { Element, AnyNode } from 'domhandler';

import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';
import {
  htmlToText,
  collectHangingIndentInners,
} from '../../common.js';
import type { MonsterAbilitiesSlice, MonsterAbility, SaveName } from './types.js';
import {
  KNOWN_LABELS,
  STAGE_LABEL_RE,
  SPELL_LIST_LABEL_RE,
} from './types.js';
import {
  extractLeadingTraits,
  parseActionGlyph,
  stripActionGlyphs,
  pullLabel,
} from './helpers.js';

const BARE_BOLD_MIN_VALUE_LEN = 10;

/** Reject candidate names that don't look like AON ability titles. */
export function isAbilityName(name: string): boolean {
  if (name.length < 3) return false;
  if (!/[A-Za-z]/.test(name)) return false;
  if (!/^[A-Z]/.test(name)) return false;
  const lower = name.toLowerCase();
  if (KNOWN_LABELS.has(lower)) return false;
  if (STAGE_LABEL_RE.test(name)) return false;
  if (SPELL_LIST_LABEL_RE.test(name)) return false;
  return true;
}

const VARIANT_OVERLAY_TOKENS: ReadonlySet<string> = new Set<string>([
  'marked', 'concealed', 'hidden', 'observed', 'unnoticed', 'undetected',
  'flat-footed', 'off-guard', 'prone', 'frightened', 'sickened', 'slowed',
  'quickened', 'clumsy', 'enfeebled', 'stupefied', 'dazzled',
  'stunned', 'paralyzed', 'unconscious', 'fleeing', 'fascinated',
  'cimurlian', 'kujiba', 'igroon', 'mogaru', 'yorak',
]);

/** Predicate identifying bare-bold tokens injected by Elite/Weak variant overlay. */
export function isVariantOverlayJunk(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 2) return true;
  if (/^[+-]?\d+$/.test(trimmed)) return true;
  if (/^[+-]?\d+\/[+-]?\d+$/.test(trimmed)) return true;
  if (VARIANT_OVERLAY_TOKENS.has(trimmed.toLowerCase())) return true;
  if (/^[A-Z]\d{1,3}$/.test(trimmed)) return true;
  if (/^(?:\d+(?:st|nd|rd|th)|Cantrips?|Constant)$/i.test(trimmed)) return true;
  return false;
}

/** Parse one hanging-indent ability's inner HTML. */
function parseSingleAbility(innerHtml: string): MonsterAbility | null {
  const nameMatch = /<b>\s*([\s\S]*?)\s*<\/b>/i.exec(innerHtml);
  if (nameMatch === null) return null;
  const name = htmlToText(nameMatch[1] ?? '').trim();
  if (name === '' || KNOWN_LABELS.has(name.toLowerCase()) || STAGE_LABEL_RE.test(name) || SPELL_LIST_LABEL_RE.test(name)) {
    return null;
  }
  const action = parseActionGlyph(innerHtml);
  let rest = innerHtml.slice(nameMatch.index + nameMatch[0].length);
  rest = stripActionGlyphs(rest);
  const { traits } = extractLeadingTraits(htmlToText(rest));
  rest = rest.replace(/^\s*\([^)]*\)\s*/, '');

  const frequency = pullLabel(rest, 'Frequency');
  const trigger = pullLabel(rest, 'Trigger');
  const requirements = pullLabel(rest, 'Requirements');
  const effect = pullLabel(rest, 'Effect');

  let saving_throw: MonsterAbility['saving_throw'] = null;
  const stRaw = pullLabel(rest, 'Saving Throw');
  if (stRaw !== null) {
    const dcM = /DC\s+(\d+)/i.exec(stRaw);
    const basic = /\bbasic\b/i.test(stRaw);
    const saveM = /\b(Fortitude|Reflex|Will)\b/i.exec(stRaw);
    let save: SaveName | null = null;
    if (saveM !== null) {
      const saveStr = saveM[1]!.toLowerCase();
      save = saveStr === 'fortitude' ? 'fort' : saveStr === 'reflex' ? 'ref' : 'will';
    }
    if (dcM !== null) saving_throw = { dc: parseInt(dcM[1]!, 10), save, basic };
  }

  const stages: Array<{ stage: number; text: string }> = [];
  const stageRe = /<b>\s*Stage\s+(\d+)\s*<\/b>([\s\S]*?)(?=<b>\s*Stage\s+\d+|$)/gi;
  let stageMatch: RegExpExecArray | null;
  while ((stageMatch = stageRe.exec(rest)) !== null) {
    const stageNum = parseInt(stageMatch[1]!, 10);
    const stageText = htmlToText(stageMatch[2] ?? '').replace(/^[\s;,]+|[\s;,]+$/g, '');
    if (Number.isFinite(stageNum)) stages.push({ stage: stageNum, text: stageText });
  }

  return {
    name, actions: action, traits,
    frequency, trigger, requirements, effect, saving_throw, stages,
    body_html: innerHtml.trim(),
    body_text: htmlToText(innerHtml),
  };
}

/** Extract hanging-indent ability blocks (excluding strikes). */
function parseAbilities(fragmentHtml: string): MonsterAbility[] {
  const out: MonsterAbility[] = [];
  for (const inner of collectHangingIndentInners(fragmentHtml)) {
    if (/^\s*<b>\s*(Melee|Ranged)\s*<\/b>/i.test(inner)) continue;
    const ability = parseSingleAbility(inner);
    if (ability !== null) out.push(ability);
  }
  return out;
}

/** Extract bare-bold top abilities via cheerio DOM walking. */
export function parseBareBoldAbilities(headHtml: string): MonsterAbility[] {
  const out: MonsterAbility[] = [];
  const flattened = headHtml.replace(/<b>\s*<b>([^<]+)<\/b>\s*<\/b>/gi, '<b>$1</b>');
  const $head = load(`<div id="head-root">${flattened}</div>`);

  $head('#head-root b').each((_index, element) => {
    const $bold = $head(element);
    if ($bold.children().length > 0) return;
    if ($bold.parents('span.hanging-indent').length > 0) return;
    if ($bold.closest('h1, h2, h3').length > 0) return;
    if ($bold.parents('a.monster-pwl-link').length > 0) return;
    if ($bold.parents('h2.hide-on-print, h3.hide-on-print').length > 0) return;

    const name = $bold.text().trim().replace(/:$/, '');
    if (!isAbilityName(name)) return;

    const parent = (element as Element).parent;
    const startsAfter: Element = (
      parent !== null
      && parent !== undefined
      && parent.type === 'tag'
      && (parent as Element).tagName.toLowerCase() === 'a'
      && (parent as Element).children.length === 1
    )
      ? (parent as Element)
      : (element as Element);

    const valueNodes: AnyNode[] = [];
    let cur = startsAfter.next as AnyNode | null;
    while (cur !== null) {
      if (cur.type === 'tag') {
        const tagName = (cur as Element).tagName.toLowerCase();
        if (tagName === 'b' || tagName === 'br' || tagName === 'hr') break;
      }
      valueNodes.push(cur);
      cur = (cur as { next: AnyNode | null }).next;
    }
    const valueHtml = valueNodes.map((node) => $head.html(node as AnyNode)).join('');
    const valueText = htmlToText(valueHtml).trim();
    if (valueText.length < BARE_BOLD_MIN_VALUE_LEN) return;

    const action = parseActionGlyph(valueHtml);
    const stripped = stripActionGlyphs(valueHtml);
    const { traits } = extractLeadingTraits(htmlToText(stripped));
    const restHtml = stripped.replace(/^\s*\([^)]*\)\s*/, '');

    const frequency = pullLabel(restHtml, 'Frequency');
    const trigger = pullLabel(restHtml, 'Trigger');
    const requirements = pullLabel(restHtml, 'Requirements');
    const effect = pullLabel(restHtml, 'Effect');

    let saving_throw: MonsterAbility['saving_throw'] = null;
    const stRaw = pullLabel(restHtml, 'Saving Throw');
    if (stRaw !== null) {
      const dcM = /DC\s+(\d+)/i.exec(stRaw);
      const basic = /\bbasic\b/i.test(stRaw);
      const saveM = /\b(Fortitude|Reflex|Will)\b/i.exec(stRaw);
      let save: SaveName | null = null;
      if (saveM !== null) {
        const saveStr = saveM[1]!.toLowerCase();
        save = saveStr === 'fortitude' ? 'fort' : saveStr === 'reflex' ? 'ref' : 'will';
      }
      if (dcM !== null) saving_throw = { dc: parseInt(dcM[1]!, 10), save, basic };
    }

    const stages: Array<{ stage: number; text: string }> = [];
    const stageRe = /<b>\s*Stage\s+(\d+)\s*<\/b>([\s\S]*?)(?=<b>\s*Stage\s+\d+|$)/gi;
    let stageMatch: RegExpExecArray | null;
    while ((stageMatch = stageRe.exec(restHtml)) !== null) {
      const stageNum = parseInt(stageMatch[1]!, 10);
      const stageText = htmlToText(stageMatch[2] ?? '').replace(/^[\s;,]+|[\s;,]+$/g, '');
      if (Number.isFinite(stageNum)) stages.push({ stage: stageNum, text: stageText });
    }

    out.push({
      name,
      actions: action,
      traits,
      frequency,
      trigger,
      requirements,
      effect,
      saving_throw,
      stages,
      body_html: valueHtml.trim(),
      body_text: valueText,
    });
  });

  return out;
}

/** Split body HTML on `<hr/>` into defenses + offense fragments. */
function splitBodySections(bodyHtml: string): { defenses: string; offense: string } {
  const match = /<hr\s*\/?>/i.exec(bodyHtml);
  if (match === null) return { defenses: bodyHtml, offense: '' };
  return { defenses: bodyHtml.slice(0, match.index), offense: bodyHtml.slice(match.index + match[0].length) };
}

/**
 * Extract the head-of-statblock HTML fragment (everything before the first
 * `<hr/>` boundary) from the resolved monster span.
 */
function getMonsterHeadHtml(root: CheerioAPI, span: CheerioNode): string {
  const pageSpan = root('span.monster-page').first();
  const direct = pageSpan.length > 0 ? pageSpan : span;
  const spanHtml = direct.html() ?? '';
  return spanHtml.split(/<hr\s*\/?>/i)[0] ?? '';
}

/** Extract abilities slice (top + defensive + offensive abilities). */
export function extractMonsterAbilities(common: CommonExtraction, root: CheerioAPI, span: CheerioNode): MonsterAbilitiesSlice {
  const { defenses: defensesHtml, offense: offenseHtml } = splitBodySections(common.body_html);
  const headHtml = getMonsterHeadHtml(root, span);

  const hangingTopAbilities = parseAbilities(headHtml);
  const bareTopAbilities = parseBareBoldAbilities(headHtml);
  const seenNames = new Set(hangingTopAbilities.map((ability) => ability.name.toLowerCase()));
  const top_abilities = [
    ...hangingTopAbilities,
    ...bareTopAbilities.filter((ability) => !seenNames.has(ability.name.toLowerCase())),
  ];

  return {
    top_abilities,
    defensive_abilities: parseAbilities(defensesHtml),
    offensive_abilities: parseAbilities(offenseHtml),
  };
}

export type MonsterAbilitiesOutput = 'success' | 'error';

class MonsterAbilitiesNode extends ScalarNode<ScrapeState, MonsterAbilitiesOutput> {
  public readonly name = 'extract:monster-abilities';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<MonsterAbilitiesOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('error');

    const abilities = extractMonsterAbilities(common, root, target);

    state.output = { ...state.output, ...abilities };

    return NodeOutputBuilder.of('success');
  }
}

export const monsterAbilitiesNode = new MonsterAbilitiesNode();
