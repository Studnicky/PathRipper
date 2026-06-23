// MediaWiki / dandwiki (5e SRD) extraction utilities.
//
// The dnd5e plugin parses dandwiki MediaWiki pages. Content lives under
// `div.mw-parser-output`; the page name is exposed via the
// `span.mw-page-title-main` portion of `h1#firstHeading`. Spell pages carry a
// `table.monstats` (a.k.a. `table.d20`) statblock with a level/school row plus
// `Casting time` / `Range` / `Components` / `Duration` rows. Non-spell pages
// (creatures, items) fall back to generic extraction.
//
// Plugin-specific selectors and regexes live here; the framework strategy
// interfaces (CommonStrategy) are satisfied in `strategies/dnd5e.ts`.
import { load } from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode } from 'domhandler';

import type { LinkRef, Section } from '../../src/taxonomy/ExtractionStrategy.js';
import type { SpellTable } from './SpellTable.js';

/** Common per-page projection shared by every dnd5e concept. */
export type Dnd5eCommon = {
  name:      string;
  url:       string;
  source:    { book: string; page: number | null };
  category:  string | null;
  body_text: string;
  body_html: string;
  sections:  Section[];
  links:     LinkRef[];
};

/** dandwiki source book label — every 5e SRD page is published under this collection. */
const SRD_BOOK = '5e SRD';

/** Load raw HTML into a CheerioAPI handle. */
export function loadHtml(html: string): CheerioAPI {
  return load(html);
}

/** Resolve the MediaWiki content root (`div.mw-parser-output`). */
export function getContentRoot(root: CheerioAPI): Cheerio<AnyNode> {
  return root('div.mw-parser-output').first();
}

/**
 * Page display name. Prefers `span.mw-page-title-main` (already stripped of the
 * `5e SRD:` namespace prefix); falls back to the decoded URL slug after
 * `5e_SRD:`.
 */
export function extractPageName(root: CheerioAPI, url: string): string {
  const main = root('h1#firstHeading span.mw-page-title-main').first().text().trim();
  if (main.length > 0) return main;

  const match = /5e_SRD:([^?#]+)/i.exec(url);
  if (match !== null) {
    return decodeURIComponent(match[1]!).replace(/_/g, ' ').trim();
  }
  return '';
}

/**
 * Category derived from the page breadcrumb (`Back to … → <a>X</a>`). Returns
 * the last `/wiki/5e_SRD:` breadcrumb link text that is NOT a "* Spell List"
 * (e.g. "Spells", "Creatures"). Null when no breadcrumb is present.
 */
export function extractCategory(root: CheerioAPI): string | null {
  const breadcrumb = findBreadcrumb(root);
  if (breadcrumb === null) return null;

  let category: string | null = null;
  breadcrumb.find('a[href^="/wiki/5e_SRD:"]').each((_index, element) => {
    const anchor = root(element);
    const href = anchor.attr('href') ?? '';
    const text = anchor.text().trim();
    // Skip the SRD root document and any "* Spell List" leaf links.
    if (/System_Reference_Document/i.test(href)) return;
    if (/Spell[_ ]List/i.test(href) || /spell list/i.test(text)) return;
    if (text.length > 0) category = text;
  });
  return category;
}

/** Locate the breadcrumb paragraph (`<p>Back to …</p>`) inside the content root. */
function findBreadcrumb(root: CheerioAPI): Cheerio<AnyNode> | null {
  let found: Cheerio<AnyNode> | null = null;
  root('div.mw-parser-output > p').each((_index, element) => {
    if (found !== null) return;
    const paragraph = root(element);
    if (paragraph.text().trimStart().startsWith('Back to')) {
      found = paragraph;
    }
  });
  return found;
}

/**
 * Plain-text body. Concatenates the text of content `<p>` elements, excluding
 * the breadcrumb / "Back to" footer paragraphs.
 */
export function extractBodyText(root: CheerioAPI): string {
  const parts: string[] = [];
  // Descendant `<p>` (not just direct children): creature/item pages nest their
  // descriptive paragraphs inside statblock tables, so a child-only selector
  // would miss them. Breadcrumb / footer paragraphs are filtered by prefix.
  root('div.mw-parser-output p').each((_index, element) => {
    const paragraph = root(element);
    const text = paragraph.text().replace(/\s+/g, ' ').trim();
    if (text.length === 0) return;
    if (text.startsWith('Back to')) return;
    parts.push(text);
  });
  return parts.join('\n\n');
}

/** Raw HTML of the content root. */
export function extractBodyHtml(root: CheerioAPI): string {
  return getContentRoot(root).html() ?? '';
}

/** Inline `/wiki/5e_SRD:` cross-reference links harvested from the content root. */
export function extractLinks(root: CheerioAPI): LinkRef[] {
  const links: LinkRef[] = [];
  root('div.mw-parser-output a[href^="/wiki/5e_SRD:"]').each((_index, element) => {
    const anchor = root(element);
    const href = anchor.attr('href') ?? '';
    const text = anchor.text().trim();
    if (href.length === 0) return;
    links.push({ href, text, kind: 'srd', id: null });
  });
  return links;
}

/**
 * Section walker. Emits a {@link Section} per `<h2>` / `<h3>` carrying a
 * `span.mw-headline`, collecting subsequent sibling nodes until the next
 * heading of equal-or-higher rank.
 */
export function extractSections(root: CheerioAPI): Section[] {
  const sections: Section[] = [];
  root('div.mw-parser-output > h2, div.mw-parser-output > h3').each((_index, element) => {
    const headingEl = root(element);
    const heading = headingEl.find('span.mw-headline').text().trim();
    if (heading.length === 0) return;
    const level: 2 | 3 = element.name === 'h2' ? 2 : 3;

    const bodyParts: string[] = [];
    const htmlParts: string[] = [];
    const sectionLinks: LinkRef[] = [];

    let sibling = headingEl.next();
    while (sibling.length > 0) {
      const node = sibling.get(0);
      const tag = node !== undefined && node !== null ? node.name : undefined;
      if (tag === 'h2' || tag === 'h3') break;

      const text = sibling.text().replace(/\s+/g, ' ').trim();
      if (text.length > 0) bodyParts.push(text);
      const html = sibling.html();
      if (html !== null) htmlParts.push(html);

      sibling.find('a[href^="/wiki/5e_SRD:"]').each((_linkIndex, linkEl) => {
        const anchor = root(linkEl);
        const href = anchor.attr('href') ?? '';
        if (href.length === 0) return;
        sectionLinks.push({ href, text: anchor.text().trim(), kind: 'srd', id: null });
      });

      sibling = sibling.next();
    }

    sections.push({
      heading,
      level,
      body_text: bodyParts.join('\n\n'),
      body_html: htmlParts.join(''),
      links: sectionLinks,
    });
  });
  return sections;
}

/**
 * Locate the spell statblock table (`table.monstats`, falling back to
 * `table.d20`) inside the content root. Null when absent.
 */
function findSpellTable(root: CheerioAPI): Cheerio<AnyNode> | null {
  const monstats = root('div.mw-parser-output table.monstats').first();
  if (monstats.length > 0) return monstats;
  const d20 = root('div.mw-parser-output table.d20').first();
  if (d20.length > 0) return d20;
  return null;
}

/**
 * Content classification. Returns `'spell'` when the page carries a statblock
 * table whose first `td[colspan="2"] i` row matches a leveled-spell / cantrip
 * pattern AND the table has a `Casting time` header row. Falls back to `'spell'`
 * when the breadcrumb links to the Spells category. Otherwise `'generic'`.
 */
export function classifyDnd5ePage(root: CheerioAPI): string {
  const table = findSpellTable(root);
  if (table !== null) {
    const levelRow = table.find('td[colspan="2"] i').first().text();
    const isSpellLevel = /(\d+)(?:st|nd|rd|th)-level|cantrip/i.test(levelRow);

    let hasCastingTime = false;
    table.find('th').each((_index, element) => {
      const label = root(element).text().trim().replace(/:$/, '').toLowerCase();
      if (label === 'casting time') hasCastingTime = true;
    });

    if (isSpellLevel && hasCastingTime) return 'spell';
  }

  const breadcrumb = findBreadcrumb(root);
  if (breadcrumb !== null && breadcrumb.find('a[href="/wiki/5e_SRD:Spells"]').length > 0) {
    return 'spell';
  }

  return 'generic';
}

/**
 * Parse the spell statblock. Reads the level/school from the first
 * `td[colspan="2"] i` row, then walks th/td rows keyed by the (colon-stripped,
 * lowercased) header text. `higher_levels` is harvested from the
 * `At Higher Levels.` paragraph in the content body.
 */
export function parseSpellTable(root: CheerioAPI): SpellTable {
  const empty: SpellTable = {
    level:         null,
    school:        null,
    casting_time:  null,
    range:         null,
    components:    null,
    duration:      null,
    higher_levels: null,
  };

  const table = findSpellTable(root);
  if (table === null) return empty;

  const result: SpellTable = { ...empty };

  // Level + school row: `<td colspan="2"><i>3rd-level evocation</i></td>` or
  // `<i>Evocation cantrip</i>`.
  const levelText = table.find('td[colspan="2"] i').first().text().replace(/\s+/g, ' ').trim();
  const leveled = /(\d+)(?:st|nd|rd|th)-level\s+(\w+)/i.exec(levelText);
  if (leveled !== null) {
    result.level = Number.parseInt(leveled[1]!, 10);
    result.school = leveled[2]!.toLowerCase();
  } else {
    const cantrip = /(\w+)\s+cantrip/i.exec(levelText);
    if (cantrip !== null) {
      result.level = 0;
      result.school = cantrip[1]!.toLowerCase();
    }
  }

  // Keyed th/td rows.
  table.find('tr').each((_index, element) => {
    const row = root(element);
    const headerEl = row.find('th').first();
    if (headerEl.length === 0) return;
    const label = headerEl.text().replace(/\s+/g, ' ').trim().replace(/:$/, '').toLowerCase();
    const value = row.find('td').first().text().replace(/\s+/g, ' ').trim();
    if (value.length === 0) return;

    if (label === 'casting time') result.casting_time = value;
    else if (label === 'range') result.range = value;
    else if (label === 'components') result.components = value;
    else if (label === 'duration') result.duration = value;
  });

  // Higher-levels paragraph.
  root('div.mw-parser-output > p').each((_index, element) => {
    if (result.higher_levels !== null) return;
    const paragraph = root(element);
    const text = paragraph.text().replace(/\s+/g, ' ').trim();
    if (text.includes('At Higher Levels')) {
      result.higher_levels = text.replace(/^At Higher Levels\.\s*/i, '').trim();
    }
  });

  return result;
}

/** Assemble the shared per-page projection consumed by every dnd5e concept. */
export function extractCommonDnd5e(root: CheerioAPI, url: string): Dnd5eCommon {
  return {
    name:      extractPageName(root, url),
    url,
    source:    { book: SRD_BOOK, page: null },
    category:  extractCategory(root),
    body_text: extractBodyText(root),
    body_html: extractBodyHtml(root),
    sections:  extractSections(root),
    links:     extractLinks(root),
  };
}
