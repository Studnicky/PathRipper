// Familiar shared parsing utilities.
import type { ActionCost } from '../../common.js';
import { htmlToText, loadFragment } from '../../common.js';
import type { FamiliarAbilityRef, FamiliarSubAbility } from './types.js';
import type { Element, AnyNode } from 'domhandler';

/** Detect whether a Familiars.aspx URL points at a Specific creature page. */
export function isSpecificUrl(url: string): boolean {
  return /[?&]Specific=true/i.test(url);
}

/**
 * Parse a `<b>Granted Abilities</b>` field's raw HTML into a list of
 * familiar-ability anchor references. AON renders the list as
 * `<u><a href="Familiars.aspx?ID=N">name</u></a>, <u><a …>name</u></a>`.
 */
export function parseGrantedAbilities(html: string | null): FamiliarAbilityRef[] {
  if (html === null) return [];
  const out: FamiliarAbilityRef[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) !== null) {
    const href = match[1] ?? '';
    if (!/Familiars\.aspx/i.test(href)) continue;
    const name = htmlToText(match[2] ?? '').replace(/[,;]+$/, '').trim();
    if (name === '') continue;
    const idMatch = /\?ID=(\d+)/i.exec(href);
    const familiar_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    const key = `${name}|${familiar_id ?? 'n'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, familiar_id });
  }
  return out;
}

/**
 * Parse the `<b>Ability Type</b>` value HTML into the discriminator and an
 * optional Specific-Familiar parent reference.
 *
 * Examples:
 *   "Familiar"
 *   "Master"
 *   `Specific Familiar - <a href="Familiars.aspx?ID=26&Specific=true">Elemental Wisp</a>`
 */
export function parseAbilityType(html: string | null): {
  ability_type:             'Familiar' | 'Master' | 'Specific Familiar' | null;
  specific_familiar_parent: FamiliarAbilityRef | null;
} {
  if (html === null) return { ability_type: null, specific_familiar_parent: null };
  const text = htmlToText(html);
  if (/^master\b/i.test(text)) {
    return { ability_type: 'Master', specific_familiar_parent: null };
  }
  if (/^specific familiar\b/i.test(text)) {
    const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
    const match = anchorRe.exec(html);
    let parent: FamiliarAbilityRef | null = null;
    if (match !== null) {
      const href = match[1] ?? '';
      if (/Familiars\.aspx/i.test(href)) {
        const name = htmlToText(match[2] ?? '').trim();
        const idMatch = /\?ID=(\d+)/i.exec(href);
        const familiar_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
        if (name !== '') parent = { name, familiar_id };
      }
    }
    return { ability_type: 'Specific Familiar', specific_familiar_parent: parent };
  }
  if (/^familiar\b/i.test(text)) {
    return { ability_type: 'Familiar', specific_familiar_parent: null };
  }
  return { ability_type: null, specific_familiar_parent: null };
}

const ACTION_LABEL_TO_COST: ReadonlyMap<string, ActionCost> = new Map<string, ActionCost>([
  ['one-action',     'one-action'],
  ['single-action',  'one-action'],
  ['two-actions',    'two-actions'],
  ['three-actions',  'three-actions'],
  ['reaction',       'reaction'],
  ['free-action',    'free-action'],
]);

function parseActionGlyph(html: string): ActionCost | null {
  const match = /<span\b[^>]*class=['"]action['"][^>]*>([\s\S]*?)<\/span>/i.exec(html);
  if (match === null) return null;
  const inner = match[1] ?? '';
  const lab = /\[([a-z-]+)\]/i.exec(inner);
  if (lab === null) return null;
  return ACTION_LABEL_TO_COST.get(lab[1]!.toLowerCase()) ?? null;
}

/** Pull a single `<b>Label</b> value` value from a fragment, stopping at the next `<b>` or `<br>`. */
function pullLabel(html: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `<b>\\s*${escaped}\\s*<\\/b>\\s*([\\s\\S]*?)(?=<b>|<br\\s*\\/?>|<h[1-3]\\b|$)`,
    'i',
  );
  const match = regex.exec(html);
  if (match === null) return null;
  const text = htmlToText(match[1] ?? '').replace(/[\s;,]+$/, '').trim();
  return text === '' ? null : text;
}

/**
 * Pull the first `<b>Source</b>` reference out of a fragment. Returns null
 * when no Sources.aspx anchor is found.
 */
function pullFirstSource(html: string): SourceRef | null {
  const regex = /<b>\s*Source\s*<\/b>\s*<a[^>]*href="[^"]*Sources\.aspx\?ID=(\d+)"[^>]*>\s*<i>([^<]+)<\/i>\s*<\/a>(?:[^<]*pg\.\s*(\d+))?/i;
  const match = regex.exec(html);
  if (match === null) return null;
  const source_id = parseInt(match[1] ?? '0', 10);
  const label = match[2] ?? '';
  const pageRaw = match[3];
  const page = pageRaw !== undefined ? parseInt(pageRaw, 10) : null;
  const bookMatch = /^(.*?)\s*pg\.\s*\d+/i.exec(label);
  const book = bookMatch !== null ? bookMatch[1]!.trim() : label.trim();
  return {
    book:      book === '' ? null : book,
    page:      page !== null && Number.isFinite(page) ? page : null,
    source_id: Number.isFinite(source_id) ? source_id : null,
    raw:       label,
  };
}

interface SourceRef {
  book:      string | null;
  page:      number | null;
  source_id: number | null;
  raw:       string;
}

/**
 * Extract `<h2 class="title">` sub-ability sections from the body HTML.
 *
 * Walks the body fragment as a fresh cheerio DOM so heading-to-sibling
 * boundaries are exact: each section accumulates real DOM nodes until the
 * next `h2.title` (decorative `feel-title` / `hide-on-print` headings are
 * skipped via `closest`/class checks).
 */
export function parseSubAbilities(bodyHtml: string): FamiliarSubAbility[] {
  if (bodyHtml.trim() === '') return [];
  const bodyRoot = loadFragment(bodyHtml, 'body-root');
  const out: FamiliarSubAbility[] = [];

  bodyRoot('#body-root h2.title').each((_index, element) => {
    const headEl = bodyRoot(element);
    const cls = (headEl.attr('class') ?? '').toLowerCase();
    if (cls.includes('feel-title') || cls.includes('hide-on-print') || cls.includes('legacy-content-warning')) {
      return;
    }

    const headingHtml = bodyRoot.html(element) ?? '';
    const heading_action_cost = parseActionGlyph(headingHtml);

    // Heading text + ability link
    const anchor = headEl.find('a').first();
    const anchorHref = anchor.attr('href') ?? '';
    let familiar_id: number | null = null;
    if (/Familiars\.aspx/i.test(anchorHref)) {
      const idMatch = /\?ID=(\d+)/i.exec(anchorHref);
      familiar_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    }
    // Strip action glyph from heading text before reading the name.
    const headingClone = headEl.clone();
    headingClone.find('span.action').remove();
    const name = headingClone.text().replace(/\s+/g, ' ').trim();
    if (name === '') return;

    // Walk siblings until the next non-decorative h2.title, collecting body HTML.
    const traits: string[] = [];
    const traitSeen = new Set<string>();
    const fragments: string[] = [];

    let cur = (element as Element).next as AnyNode | null;
    while (cur !== null) {
      if (cur.type === 'tag') {
        const next = cur as Element;
        const tagName = next.tagName.toLowerCase();
        if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3') {
          const nextCls = (next.attribs?.['class'] ?? '').toLowerCase();
          const decorative =
               nextCls.includes('feel-title')
            || nextCls.includes('hide-on-print')
            || nextCls.includes('legacy-content-warning');
          if (!decorative && nextCls.includes('title')) break;
        }
        if (tagName === 'span') {
          const spanCls = (next.attribs?.['class'] ?? '').toLowerCase();
          if (spanCls.startsWith('trait')) {
            const traitText = bodyRoot(next).text().replace(/\s+/g, ' ').trim();
            if (traitText !== '' && !traitSeen.has(traitText)) {
              traitSeen.add(traitText);
              traits.push(traitText);
            }
          }
        }
      }
      fragments.push(bodyRoot.html(cur as AnyNode));
      cur = (cur as { next: AnyNode | null }).next;
    }

    const body_html = fragments.join('').trim();
    const body_text = htmlToText(body_html);
    const action_cost = heading_action_cost ?? parseActionGlyph(body_html);

    out.push({
      name,
      familiar_id,
      action_cost,
      traits,
      frequency:  pullLabel(body_html, 'Frequency'),
      effect:     pullLabel(body_html, 'Effect'),
      trigger:    pullLabel(body_html, 'Trigger'),
      source:     pullFirstSource(body_html),
      body_text,
      body_html,
    });
  });

  return out;
}

/**
 * Pull the verbatim value HTML for a `<b>Label</b>` pair out of a raw HTML
 * fragment, stopping at the next `<b>`, `<br>`, `<h{1,2,3}>`, or end of
 * fragment.
 *
 * Familiar pages emit their header fields inline in the content span without
 * the usual `<hr />` boundary between head and body, so `c.field_map` is
 * routinely empty and we have to scrape the labels straight out of the
 * pre-statblock prose ourselves.
 */
export function pullFieldHtml(html: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `<b>\\s*${escaped}\\s*<\\/b>\\s*([\\s\\S]*?)(?=<b>|<br\\s*\\/?>|<h[1-3]\\b|$)`,
    'i',
  );
  const match = regex.exec(html);
  if (match === null) return null;
  const valueHtml = (match[1] ?? '').trim();
  return valueHtml === '' ? null : valueHtml;
}

/** Pull a `<b>Label</b>` value as flattened text from a raw HTML fragment. */
export function pullField(html: string, label: string): string | null {
  const valueHtml = pullFieldHtml(html, label);
  if (valueHtml === null) return null;
  const text = htmlToText(valueHtml).replace(/[\s;,]+$/, '').trim();
  return text === '' ? null : text;
}

/** Return the head fragment of the content span — the prose before any `<h2 class="title">` block. */
export function bodyHeadFragment(bodyHtml: string): string {
  const match = /<h2\b[^>]*class=['"][^'"]*title[^'"]*['"][^>]*>/i.exec(bodyHtml);
  return match === null ? bodyHtml : bodyHtml.slice(0, match.index);
}
