// Shared utilities + types for the AON (Archives of Nethys, 2e.aonprd.com)
// HTML parse plugin. Per-type extractors (spell, monster, feat, …) consume the
// structures produced here and add type-narrowed projections on top — but the
// shared foundation always captures the page's raw label/value pairs, ordered
// sections, and inline link references so no data is ever silently dropped.
import { load, type CheerioAPI, type Cheerio } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

// ─── Public types ─────────────────────────────────────────────────────────────

/** All AON page kinds we recognize. `generic`/`unknown` are catch-alls. */
export type AonPageType =
  | 'spell'
  | 'feat'
  | 'monster'
  | 'equipment'
  | 'weapon'
  | 'armor'
  | 'shield'
  | 'condition'
  | 'background'
  | 'trait'
  | 'ancestry'
  | 'class'
  | 'action'
  | 'hazard'
  | 'ritual'
  | 'deity'
  | 'archetype'
  | 'generic'
  | 'unknown';

/** Action-cost glyph normalized to a stable enum. */
export type ActionCost =
  | 'one-action'
  | 'two-actions'
  | 'three-actions'
  | 'reaction'
  | 'free-action'
  | 'variable';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'unique';

export type PfsLegality = 'standard' | 'limited' | 'restricted';

/** Reference to an AON Sources.aspx entry with parsed page number. */
export interface SourceRef {
  /** Book title — e.g. "Player Core". */
  book:      string | null;
  /** Page number within the source book. */
  page:      number | null;
  /** AON Sources.aspx ID. */
  source_id: number | null;
  /** Raw text as displayed (e.g. "Player Core pg. 287"). */
  raw:       string;
}

/** Inline cross-reference harvested from a page body. */
export interface LinkRef {
  /** Verbatim href (resolved against `https://2e.aonprd.com`). */
  href: string;
  /** Display text of the anchor. */
  text: string;
  /** Target kind derived from `.aspx` filename — `Spells`, `Traits`, etc. */
  kind: string;
  /** Numeric ID extracted from `?ID=…`, when present. */
  id:   number | null;
}

/** A single `<b>Label</b> Value<br />` pair captured from the header section. */
export interface HarvestedField {
  /** Label text, stripped of trailing colon/whitespace. */
  label:      string;
  /** Value with all HTML tags removed and entities decoded. */
  value_text: string;
  /** Verbatim inner HTML between this label and the next boundary. */
  value_html: string;
  /** Order in which the field appeared (0-based). */
  order:      number;
}

/** A `<h{2,3} class="title">` heading with its body and links. */
export interface Section {
  heading:   string;
  level:     2 | 3;
  body_text: string;
  body_html: string;
  links:     LinkRef[];
}

/** Trait pill list classified by CSS variant. */
export interface TraitInventory {
  /** All trait labels in source order, deduplicated. */
  traits:    string[];
  /** Rarity (highest-priority class wins): unique > rare > uncommon > common. */
  rarity:    Rarity;
  /** Size trait if a `<span class="traitsize">` is present. */
  size:      string | null;
  /** Alignment trait if a legacy `<span class="traitalignment">` is present. */
  alignment: string | null;
  /** Trait-link IDs (Traits.aspx?ID=N) keyed by trait name. */
  trait_ids: Record<string, number>;
}

/** Title-line breakdown — name + level/category marker + action cost + flags. */
export interface TitleInventory {
  /** Display name with action glyph and right-floated marker stripped. */
  name:        string;
  /** Right-floated marker verbatim — e.g. "Spell 5", "Feat 1", "Item 0+". */
  level_label: string | null;
  /** Numeric level parsed from the trailing integer in `level_label`. */
  level:       number | null;
  /** Marker prefix word — e.g. "Spell", "Feat", "Item", "Creature", "Background". */
  level_kind:  string | null;
  /** Plus-suffix flag — `Item 0+` indicates tiered variants on the page. */
  tiered:      boolean;
  /** Action-cost glyph found inside the title (when applicable). */
  action_cost: ActionCost | null;
  /** PFS legality badge, when present. */
  pfs:         PfsLegality | null;
  /** True when the page carries a `legacy-content-warning` heading. */
  legacy:      boolean;
  /** URL to the legacy/remaster sibling page (sidebar redirect), if shown. */
  alt_edition_url: string | null;
}

/** The exhaustive shared shape extracted from every AON detail page. */
export interface CommonExtraction {
  url:          string;
  page_type:    AonPageType;
  title:        TitleInventory;
  traits:       TraitInventory;
  /** First (header) Source ref. */
  source:       SourceRef;
  /** All Source refs on the page (header + body footnotes). */
  sources:      SourceRef[];
  /** Verbatim ordered field/value pairs harvested from the header section. */
  fields:       HarvestedField[];
  /** Header fields keyed by label for ergonomic lookup (first occurrence). */
  field_map:    Record<string, string>;
  /** Free-form prose body after the first `<hr />`, flattened to text. */
  body_text:    string;
  /** Raw HTML of the body (post-`<hr />`) — preserved for downstream HTML processing. */
  body_html:    string;
  /** All `<h{2,3} class="title">` subsections in source order. */
  sections:     Section[];
  /** Every internal `<a href>` cross-reference on the page (deduplicated). */
  links:        LinkRef[];
}

// ─── URL → page type discrimination ───────────────────────────────────────────

const URL_TO_TYPE: ReadonlyMap<string, AonPageType> = new Map<string, AonPageType>([
  ['spells',          'spell'],
  ['rituals',         'ritual'],
  ['mythicspells',    'spell'],
  ['mythicrituals',   'ritual'],
  ['feats',           'feat'],
  ['mythicfeats',     'feat'],
  ['mythicdestinies', 'feat'],
  ['monsters',        'monster'],
  ['creatures',       'monster'],
  ['equipment',       'equipment'],
  ['weapons',         'weapon'],
  ['armor',           'armor'],
  ['shields',         'shield'],
  ['conditions',      'condition'],
  ['backgrounds',     'background'],
  ['traits',          'trait'],
  ['ancestries',      'ancestry'],
  ['classes',         'class'],
  ['actions',         'action'],
  ['activities',      'action'],
  ['hazards',         'hazard'],
  ['deities',         'deity'],
  ['archetypes',      'archetype'],
]);

/** Map a URL like `…/Spells.aspx?ID=1` to its page-type discriminator. */
export function detectPageType(url: string): AonPageType {
  const m = /\/([A-Za-z]+)\.aspx/.exec(url);
  if (m === null) return 'unknown';
  const path = m[1]!.toLowerCase();
  return URL_TO_TYPE.get(path) ?? 'generic';
}

// ─── Cheerio helpers ──────────────────────────────────────────────────────────

export type CheerioNode = Cheerio<AnyNode>;

/**
 * Locate the primary content `<span>` on an AON detail page.
 *
 * AON wraps each entry in an outer `<span>` containing the `<h1 class="title">`
 * header. Multiple `<h1 class="title">` may exist (monster pages have a
 * "hide-on-print" name variant before the statblock); we want the one whose
 * enclosing `<span>` contains a `<b>Source</b>` field — that's the canonical
 * field block. Falls back to the first `<h1 class="title">`'s parent span.
 */
export function findContentSpan($: CheerioAPI): CheerioNode | null {
  let chosen: CheerioNode | null = null;
  $('h1.title').each((_, el) => {
    if (chosen !== null) return;
    const span = $(el).closest('span');
    if (span.length === 0) return;
    const html = span.html() ?? '';
    if (/<b>\s*Source\s*<\/b>/i.test(html)) chosen = span;
  });
  if (chosen !== null) return chosen;
  const first = $('h1.title').first();
  if (first.length === 0) return null;
  const span = first.closest('span');
  return span.length > 0 ? span : null;
}

// ─── Title extraction ─────────────────────────────────────────────────────────

const ACTION_LABEL_TO_COST: ReadonlyMap<string, ActionCost> = new Map<string, ActionCost>([
  ['one-action',     'one-action'],
  ['single-action',  'one-action'],
  ['two-actions',    'two-actions'],
  ['three-actions',  'three-actions'],
  ['reaction',       'reaction'],
  ['free-action',    'free-action'],
]);

/** Parse the action glyph inside a title `<span class='action'>[two-actions]</span>`. */
export function readActionCost(span: CheerioNode | null): ActionCost | null {
  if (span === null || span.length === 0) return null;
  const text = span.text();
  const m = /\[([a-z-]+)\]/i.exec(text);
  if (m === null) return null;
  return ACTION_LABEL_TO_COST.get(m[1]!.toLowerCase()) ?? null;
}

/** Read PFS legality from an `<img alt="PFS Standard|Limited|Restricted">` badge. */
function readPfs(span: CheerioNode): PfsLegality | null {
  const alt = span.find('img[alt^="PFS"]').attr('alt');
  if (alt === undefined) return null;
  const lower = alt.toLowerCase();
  if (lower.includes('standard'))    return 'standard';
  if (lower.includes('limited'))     return 'limited';
  if (lower.includes('restricted'))  return 'restricted';
  return null;
}

/**
 * Extract the entity title and its right-floated level/category marker.
 *
 * The marker (`Spell 5`, `Feat 1`, `Item 0`, `Item 0+`, `Creature -1`,
 * `Background`, `Cantrip 3`, `Focus 5`) lives in a span with `margin-left:auto`
 * styling. The leading `<span style="float:left">` holds the PFS Standard
 * icon and the closing `<a href="PFS.aspx">` anchor.
 */
export function extractTitle($: CheerioAPI, span: CheerioNode): TitleInventory {
  // Monster pages put a "hide-on-print" header `<h1 class="title">Name</h1>`
  // ahead of the canonical `<h1 class="title monster-statblock-name">` with
  // the right-floated level marker. Prefer an h1 that has a level marker
  // (`<span style="margin-left:auto…">`); fall back to the first h1.
  const h1List = span.find('h1.title');
  let chosen = h1List.first();
  h1List.each((_, el) => {
    const $el = $(el);
    if ($el.find('span[style*="margin-left:auto"]').length > 0) {
      chosen = $el;
      return false;
    }
    return undefined;
  });
  const h1 = chosen;
  const clone = h1.clone();

  // Right-floated level/category marker.
  let level_label: string | null = null;
  const trailing = clone.find('span[style*="margin-left:auto"]');
  const trailingText = trailing.first().text().trim();
  if (trailingText !== '') level_label = trailingText.replace(/\s+/g, ' ');
  trailing.remove();

  // Action glyph in title.
  const actionSpan = clone.find('span.action').first();
  const action_cost = readActionCost(actionSpan.length > 0 ? actionSpan : null);
  actionSpan.remove();

  // PFS Standard / Limited badge anchor on the left.
  clone.find('span[style*="float:left"]').remove();
  clone.find('a[href*="PFS.aspx"]').remove();

  const name = clone.text().replace(/\s+/g, ' ').trim();

  // Marker breakdown: `<word> <signed int>` → kind + level; `<word>` → kind only.
  let level_kind: string | null = null;
  let level: number | null = null;
  let tiered = false;
  if (level_label !== null) {
    const m = /^([A-Za-z]+)(?:\s+(-?\d+)(\+?))?/.exec(level_label);
    if (m !== null) {
      level_kind = m[1]!;
      if (m[2] !== undefined) level = parseInt(m[2], 10);
      tiered = m[3] === '+';
    }
  }

  // Page-level legacy/remaster flags.
  const pfs = readPfs(span);
  const legacy = $('h3.title.legacy-content-warning').length > 0;
  const altLink = span.find('div.siderbarlook a').first().attr('href');
  const alt_edition_url = altLink !== undefined ? altLink : null;

  return { name, level_label, level, level_kind, tiered, action_cost, pfs, legacy, alt_edition_url };
}

// ─── Trait extraction ─────────────────────────────────────────────────────────

const RARITY_CLASSES: ReadonlyArray<{ cls: string; rarity: Rarity }> = [
  { cls: 'traitunique',   rarity: 'unique' },
  { cls: 'traitrare',     rarity: 'rare' },
  { cls: 'traituncommon', rarity: 'uncommon' },
];

/** Extract trait pills with rarity, size, and alignment classification. */
export function extractTraits($: CheerioAPI, span: CheerioNode): TraitInventory {
  const traits: string[] = [];
  const seen = new Set<string>();
  const trait_ids: Record<string, number> = {};
  let rarity: Rarity = 'common';
  let size:      string | null = null;
  let alignment: string | null = null;

  span.find('span.trait, span.traitsize, span.traitalignment, span.traituncommon, span.traitrare, span.traitunique')
    .each((_, el) => {
      const $el = $(el);
      const txt = $el.text().replace(/\s+/g, ' ').trim();
      if (txt === '' || seen.has(txt)) return;
      seen.add(txt);
      traits.push(txt);

      const cls = ($el.attr('class') ?? '').toLowerCase();
      for (const { cls: c, rarity: r } of RARITY_CLASSES) {
        if (cls.includes(c)) { rarity = r; break; }
      }
      if (cls.includes('traitsize')) size = txt;
      if (cls.includes('traitalignment')) alignment = txt;

      const href = $el.find('a').attr('href') ?? '';
      const idMatch = /\?ID=(\d+)/i.exec(href);
      if (idMatch !== null) trait_ids[txt] = parseInt(idMatch[1]!, 10);
    });

  return { traits, rarity, size, alignment, trait_ids };
}

// ─── Source extraction ────────────────────────────────────────────────────────

const SOURCE_RE = /<b>\s*Source\s*<\/b>\s*(?:<a[^>]*href="[^"]*Sources\.aspx\?ID=(\d+)"[^>]*>\s*<i>([^<]+)<\/i>\s*<\/a>(?:[^<]*pg\.\s*(\d+))?)/gi;

function parseSourceText(raw: string): { book: string | null; page: number | null } {
  const m = /^(.*?)\s*pg\.\s*(\d+)/i.exec(raw);
  if (m !== null) {
    const page = parseInt(m[2]!, 10);
    return { book: m[1]!.trim(), page: Number.isFinite(page) ? page : null };
  }
  return { book: raw.trim(), page: null };
}

/** Capture every `<b>Source</b>` reference on the page (header + body footnotes). */
export function extractSources(span: CheerioNode): SourceRef[] {
  const html = span.html() ?? '';
  const out: SourceRef[] = [];
  let match: RegExpExecArray | null;
  SOURCE_RE.lastIndex = 0;
  while ((match = SOURCE_RE.exec(html)) !== null) {
    const idStr = match[1];
    const label = match[2] ?? '';
    const { book, page } = parseSourceText(label);
    out.push({
      book,
      page,
      source_id: idStr !== undefined ? parseInt(idStr, 10) : null,
      raw:       label.trim(),
    });
  }
  return out;
}

// ─── Field harvest (header section before first `<hr />`) ─────────────────────

/** Strip HTML tags + decode common entities + normalize whitespace. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&bull;/g, '•')
    .replace(/&times;/g, '×')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Harvest `<b>Label</b> Value` pairs from the header section.
 *
 * AON uses `<br />` as field separator and `;` as multi-stat separator within
 * a single line. We split on both, then run a `<b>X</b>Y` regex per segment to
 * pull pairs in order. Stops at the first `<hr />` boundary; everything after
 * is body content (handled separately).
 */
export function harvestFields(headHtml: string): { fields: HarvestedField[]; field_map: Record<string, string> } {
  // Split on <br />, then on `;` between <b> labels (multi-stat lines like
  // "AC 13; Fort +0, Ref +4, Will +0"). We use a tolerant scanner rather than
  // regex chains because the boundary semantics matter.
  const segments: string[] = [];
  for (const line of headHtml.split(/<br\s*\/?>/i)) {
    // Within a line, split on `;` only when the next non-whitespace char is `<b>`,
    // signalling a new label.
    const parts = splitOnLabelSemicolons(line);
    for (const p of parts) {
      const trimmed = p.trim();
      if (trimmed !== '') segments.push(trimmed);
    }
  }

  const fields: HarvestedField[] = [];
  const field_map: Record<string, string> = {};
  // Field-pair regex: `<b>Label</b>` then body up to the next `<b>` or end-of-segment.
  const pairRe = /<b>\s*([^<]+?)\s*<\/b>\s*([\s\S]*?)(?=<b>|$)/gi;
  let order = 0;
  for (const seg of segments) {
    pairRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pairRe.exec(seg)) !== null) {
      const labelRaw = m[1] ?? '';
      const valueHtml = m[2] ?? '';
      const label = labelRaw.replace(/:$/, '').replace(/\s+/g, ' ').trim();
      const value_text = htmlToText(valueHtml);
      if (label === '' || value_text === '') continue;
      // Drop "Source" — captured separately as structured SourceRef.
      if (/^source$/i.test(label)) continue;
      fields.push({ label, value_text, value_html: valueHtml.trim(), order });
      if (!(label in field_map)) field_map[label] = value_text;
      order++;
    }
  }

  return { fields, field_map };
}

/**
 * Split a fragment on `;` only at depth 0 with respect to `<…>` tags AND only
 * when the next non-whitespace token is `<b>` (a new label boundary). This
 * preserves `;`-separated values that aren't multi-stat lines (e.g. legal text).
 */
function splitOnLabelSemicolons(html: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  for (let i = 0; i < html.length; i++) {
    const ch = html[i]!;
    if (ch === '<') depth++;
    if (ch === '>') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) {
      // Look ahead — split only if next non-ws is `<b>`.
      const rest = html.slice(i + 1).replace(/^\s+/, '');
      if (/^<b>/i.test(rest)) {
        out.push(buf);
        buf = '';
        continue;
      }
    }
    buf += ch;
  }
  if (buf !== '') out.push(buf);
  return out;
}

// ─── Body / sections ──────────────────────────────────────────────────────────

/**
 * Split the content span's HTML into header (before first `<hr />`) and body
 * (everything after, with the `<hr />` consumed). Subsequent `<hr />` markers
 * inside the body are preserved as-is.
 *
 * Fallback: AON entries with no field block (conditions, traits, backgrounds)
 * have no `<hr />` at all — Source is followed directly by prose. In that case
 * we treat everything after the first `<b>Source</b> … <br />` boundary as
 * body, so prose-only entries still surface a populated `body_text`.
 */
export function splitOnHr(html: string): { head: string; body: string } {
  const hrMatch = /<hr\s*\/?>/i.exec(html);
  if (hrMatch !== null) {
    return {
      head: html.slice(0, hrMatch.index),
      body: html.slice(hrMatch.index + hrMatch[0].length),
    };
  }
  // No <hr />. Locate the trailing <br /> of the Source line.
  const sourceMatch = /<b>\s*Source\s*<\/b>[\s\S]*?<br\s*\/?>/i.exec(html);
  if (sourceMatch !== null) {
    const cut = sourceMatch.index + sourceMatch[0].length;
    return { head: html.slice(0, cut), body: html.slice(cut) };
  }
  return { head: html, body: '' };
}

/**
 * Walk `<h2 class="title">` and `<h3 class="title">` headings inside the
 * content span and pair each with its trailing siblings until the next heading
 * of equal-or-higher level. Skips `feel-title` and `hide-on-print` decorative
 * variants.
 */
export function harvestSections($: CheerioAPI, span: CheerioNode): Section[] {
  const out: Section[] = [];
  const HEADING_SEL = 'h2.title, h3.title';
  span.find(HEADING_SEL).each((_, el) => {
    const $h = $(el);
    const cls = ($h.attr('class') ?? '').toLowerCase();
    if (cls.includes('feel-title') || cls.includes('hide-on-print')) return;
    if (cls.includes('legacy-content-warning')) return;
    const tag = (el as Element).tagName.toLowerCase();
    const level: 2 | 3 = tag === 'h3' ? 3 : 2;
    const heading = $h.text().replace(/\s+/g, ' ').trim();
    if (heading === '') return;

    // Collect siblings until the next h2/h3 (any level).
    const fragments: string[] = [];
    let cur = (el as Element).next as AnyNode | null;
    while (cur !== null) {
      if (cur.type === 'tag') {
        const tagName = (cur as Element).tagName.toLowerCase();
        if (tagName === 'h2' || tagName === 'h3' || tagName === 'h1') break;
      }
      fragments.push($.html(cur as AnyNode));
      cur = (cur as { next: AnyNode | null }).next;
    }
    const body_html = fragments.join('');
    out.push({
      heading,
      level,
      body_html,
      body_text: htmlToText(body_html),
      links:     harvestLinks(body_html),
    });
  });
  return out;
}

// ─── Link harvest ─────────────────────────────────────────────────────────────

const ASPX_RE = /href="([^"]*?([A-Za-z][A-Za-z0-9]*)\.aspx[^"]*)"/g;
const TEXT_RE = />([^<]*?)<\/a>/;

/** Pull every internal `<a href>` cross-reference into LinkRef objects. */
export function harvestLinks(html: string): LinkRef[] {
  const out: LinkRef[] = [];
  const seen = new Set<string>();
  // Anchor-by-anchor scan: walk every <a … href="…">…</a>.
  const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) !== null) {
    const href = match[1] ?? '';
    const inner = match[2] ?? '';
    const text = htmlToText(inner);
    const aspxMatch = /([A-Za-z][A-Za-z0-9]*)\.aspx/.exec(href);
    if (aspxMatch === null) continue;
    const kind = aspxMatch[1]!;
    const idMatch = /\?ID=(\d+)/i.exec(href);
    const id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    const key = `${href}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ href, text, kind, id });
  }
  return out;
  void ASPX_RE; void TEXT_RE;
}

// ─── Meta / head extraction ──────────────────────────────────────────────────

/**
 * Extract the numeric entity ID from a URL query string (`?ID=N`).
 * Returns null when the URL has no ID parameter.
 */
export function extractEntityId(url: string): number | null {
  const m = /[?&]ID=(\d+)/i.exec(url);
  if (m === null) return null;
  const n = parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read `<meta name="description" content="…">` from the full page HTML.
 * Must be called on the full-document CheerioAPI, not just the content span.
 */
export function extractMetaDescription($: CheerioAPI): string | null {
  const content = $('meta[name="description"]').attr('content');
  if (content === undefined || content.trim() === '') return null;
  return content.trim();
}

/**
 * Read `<meta name="keywords" content="…">` from the full page HTML.
 * AON always populates this; it includes entity name + type token.
 */
export function extractMetaKeywords($: CheerioAPI): string | null {
  const content = $('meta[name="keywords"]').attr('content');
  if (content === undefined || content.trim() === '') return null;
  return content.trim();
}

// ─── Common-extraction entry ──────────────────────────────────────────────────

/** Run the full shared extraction pipeline over a parsed AON page. */
export function extractCommon($: CheerioAPI, url: string): CommonExtraction | null {
  const span = findContentSpan($);
  if (span === null) return null;

  // Some monster pages wrap the stat block in an inner `<span class="monster-page">`.
  // Prefer it when present so we don't include adjacent layout chrome.
  const innerMonster = span.find('span.monster-page').first();
  const target = innerMonster.length > 0 ? innerMonster : span;

  const html = target.html() ?? '';
  const { head, body } = splitOnHr(html);

  const title    = extractTitle($, target);
  const traits   = extractTraits($, target);
  const sources  = extractSources(target);
  const source   = sources[0] ?? { book: null, page: null, source_id: null, raw: '' };
  const { fields, field_map } = harvestFields(head);
  const sections = harvestSections($, target);
  const links    = harvestLinks(html);

  return {
    url,
    page_type: detectPageType(url),
    title,
    traits,
    source,
    sources,
    fields,
    field_map,
    body_text: htmlToText(body),
    body_html: body.trim(),
    sections,
    links,
  };
}

// ─── Lookup + parse helpers used by per-type extractors ───────────────────────

/** Case-insensitive lookup over `field_map` for any of the given label aliases. */
export function getField(c: CommonExtraction, ...keys: string[]): string | null {
  for (const k of keys) {
    for (const fk of Object.keys(c.field_map)) {
      if (fk.toLowerCase() === k.toLowerCase()) return c.field_map[fk]!;
    }
  }
  return null;
}

/** Same as getField, but returns the verbatim HTML value for richer parsing. */
export function getFieldHtml(c: CommonExtraction, ...keys: string[]): string | null {
  for (const k of keys) {
    for (const f of c.fields) {
      if (f.label.toLowerCase() === k.toLowerCase()) return f.value_html;
    }
  }
  return null;
}

/** Pull all matching field occurrences (some labels recur, e.g. Heightened). */
export function getAllFields(c: CommonExtraction, ...keys: string[]): HarvestedField[] {
  const lc = keys.map((k) => k.toLowerCase());
  return c.fields.filter((f) => lc.includes(f.label.toLowerCase()));
}

/** Tolerant signed integer parser — extracts the first `-?\d+` from a string. */
export function asInt(val: string | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  const m = /-?\d+/.exec(val);
  if (m === null) return null;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
}

/** Treat an em-dash / `—` / `&mdash;` value as null. */
export function unlessDash<T>(value: T | null, raw: string | null): T | null {
  if (raw === null) return value;
  const stripped = raw.trim();
  if (stripped === '—' || stripped === '–' || stripped === '-') return null;
  return value;
}

/** Split on commas at depth 0 with respect to parens, returning trimmed parts. */
export function splitTopLevel(value: string, sep: ',' | ';' | '|' = ','): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  for (const ch of value) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      const t = buf.trim();
      if (t !== '') out.push(t);
      buf = '';
      continue;
    }
    buf += ch;
  }
  const t = buf.trim();
  if (t !== '') out.push(t);
  return out;
}

/** Boilerplate cheerio loader for per-type unit tests. */
export function loadHtml(html: string): CheerioAPI {
  return load(html);
}
