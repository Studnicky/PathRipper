// Shared utilities + types for the AON (Archives of Nethys, 2e.aonprd.com)
// HTML parse plugin. Per-type extractors (spell, monster, feat, …) consume the
// structures produced here and add type-narrowed projections on top — but the
// shared foundation always captures the page's raw label/value pairs, ordered
// sections, and inline link references so no data is ever silently dropped.
import { load, type CheerioAPI, type Cheerio } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

import type { CommonStrategy, SourceRef, LinkRef, Section } from '../../src/taxonomy/ExtractionStrategy.js';

// Re-export the canonical Layer-1 shapes so existing imports from `common.ts`
// continue to resolve. Per λ rules these are the SAME identifiers — no local
// aliasing. The source-of-truth lives in `src/taxonomy/ExtractionStrategy.ts`
// (plugin-agnostic) and a plugin's strategy implementation produces them.
export type { SourceRef, LinkRef, Section } from '../../src/taxonomy/ExtractionStrategy.js';

// ─── Public types ─────────────────────────────────────────────────────────────

/** All AON page kinds we recognize. `generic`/`unknown` are catch-alls. */
/**
 * URL-path → page-type entries. **This table is the single source of truth**
 * for AON page-type discrimination. Add a new entry here and the `AonPageType`
 * union, every typed switch over it, and `URL_TO_TYPE` lookups all pick it up
 * automatically via TypeScript inference.
 *
 * Multiple URL paths may map to the same page-type (e.g. `mythicspells` and
 * `spells` both → `spell`); the union deduplicates.
 */
const URL_TO_TYPE_ENTRIES = [
  // ── Core game content ────────────────────────────────────────────────────
  ['spells',           'spell'],
  ['rituals',          'ritual'],
  ['mythicspells',     'spell'],
  ['mythicrituals',    'ritual'],
  ['feats',            'feat'],
  ['mythicfeats',      'feat'],
  ['monsters',         'monster'],
  ['creatures',        'monster'],
  ['npcs',             'monster'],
  ['equipment',        'equipment'],
  ['weapons',          'weapon'],
  ['armor',            'armor'],
  ['shields',          'shield'],
  ['conditions',       'condition'],
  ['backgrounds',      'background'],
  ['traits',           'trait'],
  ['ancestries',       'ancestry'],
  ['classes',          'class'],
  ['actions',          'action'],
  ['activities',       'action'],
  ['hazards',          'hazard'],
  ['deities',          'deity'],
  ['archetypes',       'archetype'],
  ['monsterfamilies',  'monster-family'],
  ['rules',            'rule'],
  ['familiars',        'familiar'],
  ['skills',           'skill'],
  ['domains',          'domain'],
  ['sources',          'source'],
  ['articles',         'article'],
  ['deitycategories',  'deity-category'],
  ['weapongroups',     'weapon-group'],
  ['armorgroups',      'armor-group'],
  ['contributors',     'contributor'],
  // ── Monster-adjacent typed extractors ────────────────────────
  ['companions',       'animal-companion'],
  ['monsterabilities', 'monster-ability'],
  ['monstertemplates', 'monster-template'],
  // ── Character / class aggregators ────────────────────────────
  ['classsamples',      'class-sample'],
  ['classkits',         'class-kit'],
  ['npcthemetemplates', 'npc-theme-template'],
  // ── Equipment-adjacent ───────────────────────────────────────
  ['relics',        'relic'],
  ['setrelics',     'set-relic'],
  ['siegeweapons',  'siege-weapon'],
  ['vehicles',      'vehicle'],
  // ── World-meta ───────────────────────────────────────────────
  ['languages', 'language'],
  ['planes',    'plane'],
  // ── Afflictions ──────────────────────────────────────────────
  ['curses',         'curse'],
  ['diseases',       'disease'],
  ['weatherhazards', 'weather-hazard'],
  // ── Kingmaker subsystem ──────────────────────────────────────
  ['kmstructures',   'km-structure'],
  ['kmevents',       'km-event'],
  ['tactics',        'tactic'],
  ['campmeals',      'camp-meal'],
  ['campactivities', 'camp-activity'],
  ['kmwartactics',   'km-war-tactic'],
  ['kmwararmies',    'km-war-army'],
  // ── Long-tail class subclasses ───────────────────────────────
  // 34 URL kinds collapse to one shared `subclass-feature` typed extractor
  // discriminated at runtime by `subclass_family` + `parent_class` fields.
  ['bloodlines',         'subclass-feature'],
  ['mysteries',          'subclass-feature'],
  ['patrons',            'subclass-feature'],
  ['lessons',            'subclass-feature'],
  ['apparitions',        'subclass-feature'],
  ['causes',             'subclass-feature'],
  ['eidolons',           'subclass-feature'],
  ['researchfields',     'subclass-feature'],
  ['hybridstudies',      'subclass-feature'],
  ['methodologies',      'subclass-feature'],
  ['muses',              'subclass-feature'],
  ['ways',               'subclass-feature'],
  ['huntersedge',        'subclass-feature'],
  ['implements',         'subclass-feature'],
  ['consciousminds',     'subclass-feature'],
  ['subconsciousminds',  'subclass-feature'],
  ['rackets',            'subclass-feature'],
  ['druidicorders',      'subclass-feature'],
  ['instincts',          'subclass-feature'],
  ['styles',             'subclass-feature'],
  ['arcaneschools',      'subclass-feature'],
  ['arcanethesis',       'subclass-feature'],
  ['mythicdestinies',    'subclass-feature'],
  ['ikons',              'subclass-feature'],
  ['epithets',           'subclass-feature'],
  ['deviantfeats',       'subclass-feature'],
  ['heritages',          'subclass-feature'],
  ['elements',           'subclass-feature'],
  ['followers',          'subclass-feature'],
  ['practices',          'subclass-feature'],
  ['hellknightorders',   'subclass-feature'],
  ['doctrines',          'subclass-feature'],
  ['tenets',             'subclass-feature'],
  ['innovations',        'subclass-feature'],
] as const satisfies ReadonlyArray<readonly [string, string]>;

/** Page types reachable from a known URL path (derived from {@link URL_TO_TYPE_ENTRIES}). */
type UrlMappedPageType = (typeof URL_TO_TYPE_ENTRIES)[number][1];

/**
 * Discriminator for every AON page kind we recognise. `generic` is the
 * fallback for unmapped URL paths; `unknown` is reserved for pages whose
 * structure couldn't be parsed at all.
 *
 * To extend: add a row to {@link URL_TO_TYPE_ENTRIES}. The union expands
 * automatically and TypeScript enforces exhaustiveness at every consumer.
 */
export type AonPageType =
  | UrlMappedPageType
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

/** Lookup table derived from {@link URL_TO_TYPE_ENTRIES}; do not edit directly. */
const URL_TO_TYPE: ReadonlyMap<string, AonPageType> = new Map(URL_TO_TYPE_ENTRIES);

/** Map a URL like `…/Spells.aspx?ID=1` to its page-type discriminator. */
export function detectPageType(url: string): AonPageType {
  const match = /\/([A-Za-z]+)\.aspx/.exec(url);
  if (match === null) return 'unknown';
  const path = match[1]!.toLowerCase();
  return URL_TO_TYPE.get(path) ?? 'generic';
}

/** Extract the lowercase path segment from an AON URL (e.g. `/Spells.aspx` → `'spells'`). Returns null on no match. */
export function extractAonPath(url: string): string | null {
  const match = /\/([A-Za-z]+)\.aspx/i.exec(url);
  return match !== null ? match[1]!.toLowerCase() : null;
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
export function findContentSpan(root: CheerioAPI): CheerioNode | null {
  let chosen: CheerioNode | null = null;
  root('h1.title').each((_index, element) => {
    if (chosen !== null) return;
    const span = root(element).closest('span');
    if (span.length === 0) return;
    const html = span.html() ?? '';
    if (/<b>\s*Source\s*<\/b>/i.test(html)) chosen = span;
  });
  if (chosen !== null) return chosen;
  const first = root('h1.title').first();
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
  const match = /\[([a-z-]+)\]/i.exec(text);
  if (match === null) return null;
  return ACTION_LABEL_TO_COST.get(match[1]!.toLowerCase()) ?? null;
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
export function extractTitle(root: CheerioAPI, span: CheerioNode): TitleInventory {
  // Monster pages put a "hide-on-print" header `<h1 class="title">Name</h1>`
  // ahead of the canonical `<h1 class="title monster-statblock-name">` with
  // the right-floated level marker. Prefer an h1 that has a level marker
  // (`<span style="margin-left:auto…">`); fall back to the first h1.
  const h1List = span.find('h1.title');
  let chosen = h1List.first();
  h1List.each((_index, element) => {
    const $el = root(element);
    if ($el.find('span[style*="margin-left:auto"]').length > 0) {
      chosen = $el;
      return false;
    }
    return undefined;
  });
  const h1El = chosen;
  const clone = h1El.clone();

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
    const match = /^([A-Za-z]+)(?:\s+(-?\d+)(\+?))?/.exec(level_label);
    if (match !== null) {
      level_kind = match[1]!;
      if (match[2] !== undefined) level = parseInt(match[2], 10);
      tiered = match[3] === '+';
    }
  }

  // Page-level legacy/remaster flags.
  const pfs = readPfs(span);
  const legacy = root('h3.title.legacy-content-warning').length > 0;
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
export function extractTraits(root: CheerioAPI, span: CheerioNode): TraitInventory {
  const traits: string[] = [];
  const seen = new Set<string>();
  const trait_ids: Record<string, number> = {};
  let rarity: Rarity = 'common';
  let size:      string | null = null;
  let alignment: string | null = null;

  span.find('span.trait, span.traitsize, span.traitalignment, span.traituncommon, span.traitrare, span.traitunique')
    .each((_index, element) => {
      const $el = root(element);
      const txt = $el.text().replace(/\s+/g, ' ').trim();
      if (txt === '' || seen.has(txt)) return;
      seen.add(txt);
      traits.push(txt);

      const cls = ($el.attr('class') ?? '').toLowerCase();
      for (const { cls: clsCls, rarity: clsRarity } of RARITY_CLASSES) {
        if (cls.includes(clsCls)) { rarity = clsRarity; break; }
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
  const match = /^(.*?)\s*pg\.\s*(\d+)/i.exec(raw);
  if (match !== null) {
    const page = parseInt(match[2]!, 10);
    return { book: match[1]!.trim(), page: Number.isFinite(page) ? page : null };
  }
  return { book: raw.trim(), page: null };
}

/**
 * Capture every `<b>Source</b>` reference on the page (header + body footnotes).
 *
 * this is the AON-specific implementation of the
 * `SourceRefStrategy.extractSources` contract. The hardcoded
 * `<b>Source</b>` literal and `Sources.aspx?ID=` URL pattern below are AON
 * markup — non-AON plugins must supply their own implementation via a
 * different `SourceRefStrategy`.
 */
export function extractSources(span: CheerioNode): SourceRef[] {
  const html = span.html() ?? '';
  const out: SourceRef[] = [];
  const seen = new Set<string>();
  let srcMatch: RegExpExecArray | null;
  SOURCE_RE.lastIndex = 0;
  while ((srcMatch = SOURCE_RE.exec(html)) !== null) {
    const idStr = srcMatch[1];
    const label = srcMatch[2] ?? '';
    const { book, page } = parseSourceText(label);
    const source_id = idStr !== undefined ? parseInt(idStr, 10) : null;
    // Dedup by (source_id, book, page) — AON repeats the source ref under each
    // subsection on multi-feat pages (archetypes, etc.) but the canonical
    // reference is the same row.
    const key = `${source_id ?? 'n'}|${book ?? ''}|${page ?? 'n'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      book,
      page,
      source_id,
      raw: label.trim(),
    });
  }
  return out;
}

// ─── Field harvest (header section before first `<hr />`) ─────────────────────

/**
 * Strip HTML tags + decode common entities + normalize whitespace.
 *
 * Tag-adjacency rule: when a closing tag is immediately followed by an opening
 * tag (no whitespace, e.g. `<a>Taldane</a><a>Nagaji</a>`), insert a single
 * space before stripping — otherwise adjacent linked tokens collapse into
 * one (e.g. `TaldaneNagaji`). Tag-to-text adjacency (`<i>foo</i>bar`) keeps
 * the legacy no-space behavior so proper-name italics don't gain artifacts.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/[a-z][a-z0-9]*\s*>(?=<[a-z])/gi, ' ')
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
 * Return a copy of `fieldMap` with any keys whose case-insensitive form
 * appears in `claimedKeys` removed. Use in finalize nodes to drop AON labels
 * that have been lifted into structured fields, so `raw_fields` only contains
 * unstructured residue.
 */
export function stripStructuredKeys(
  fieldMap:    Readonly<Record<string, string>>,
  claimedKeys: Iterable<string>,
): Record<string, string> {
  const claimed = new Set<string>();
  for (const key of claimedKeys) claimed.add(key.trim().toLowerCase());
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fieldMap)) {
    if (claimed.has(key.trim().toLowerCase())) continue;
    out[key] = value;
  }
  return out;
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
    for (const part of parts) {
      const trimmed = part.trim();
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
    let pairMatch: RegExpExecArray | null;
    while ((pairMatch = pairRe.exec(seg)) !== null) {
      const labelRaw = pairMatch[1] ?? '';
      const valueHtml = pairMatch[2] ?? '';
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
  for (let index = 0; index < html.length; index++) {
    const char = html[index]!;
    if (char === '<') depth++;
    if (char === '>') depth = Math.max(0, depth - 1);
    if (char === ';' && depth === 0) {
      // Look ahead — split only if next non-ws is `<b>`.
      const rest = html.slice(index + 1).replace(/^\s+/, '');
      if (/^<b>/i.test(rest)) {
        out.push(buf);
        buf = '';
        continue;
      }
    }
    buf += char;
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
function isDecorativeHeading(element: Element): boolean {
  const cls = (element.attribs?.['class'] ?? '').toLowerCase();
  return cls.includes('feel-title')
      || cls.includes('hide-on-print')
      || cls.includes('legacy-content-warning');
}

/**
 * AON-specific implementation of the
 * `SectionWalkerStrategy.harvestSections` contract. The `.title` CSS class
 * filter is AON markup — non-AON plugins supply their own implementation.
 */
export function harvestSections(root: CheerioAPI, span: CheerioNode): Section[] {
  const out: Section[] = [];
  const HEADING_SEL = 'h2.title, h3.title';
  span.find(HEADING_SEL).each((_index, element) => {
    if (isDecorativeHeading(element as Element)) return;
    const $heading = root(element);
    const tag = (element as Element).tagName.toLowerCase();
    const level: 2 | 3 = tag === 'h3' ? 3 : 2;
    const heading = $heading.text().replace(/\s+/g, ' ').trim();
    if (heading === '') return;

    // Collect siblings until the next real h1/h2/h3. Decorative title variants
    // (legacy-content-warning, feel-title, hide-on-print) sit between a real
    // heading and its body — skip over them entirely rather than emit them
    // into the body or treat them as a section boundary.
    const fragments: string[] = [];
    let cur = (element as Element).next as AnyNode | null;
    while (cur !== null) {
      if (cur.type === 'tag') {
        const next = cur as Element;
        const tagName = next.tagName.toLowerCase();
        if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3') {
          if (!isDecorativeHeading(next)) break;
          cur = (cur as { next: AnyNode | null }).next;
          continue;
        }
      }
      fragments.push(root.html(cur as AnyNode));
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
    const entityId = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    const key = `${href}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ href, text, kind, id: entityId });
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
  const match = /[?&]ID=(\d+)/i.exec(url);
  if (match === null) return null;
  const num = parseInt(match[1]!, 10);
  return Number.isFinite(num) ? num : null;
}

/**
 * Read `<meta name="description" content="…">` from the full page HTML.
 * Must be called on the full-document CheerioAPI, not just the content span.
 */
export function extractMetaDescription(root: CheerioAPI): string | null {
  const content = root('meta[name="description"]').attr('content');
  if (content === undefined || content.trim() === '') return null;
  return content.trim();
}

/**
 * Read `<meta name="keywords" content="…">` from the full page HTML.
 * AON always populates this; it includes entity name + type token.
 */
export function extractMetaKeywords(root: CheerioAPI): string | null {
  const content = root('meta[name="keywords"]').attr('content');
  if (content === undefined || content.trim() === '') return null;
  return content.trim();
}

// ─── Common-extraction entry ──────────────────────────────────────────────────

/**
 * Run the full shared extraction pipeline over a parsed page.
 *
 * The source-citation walk and the section harvester are supplied via
 * {@link CommonStrategy}. The remaining helpers (`findContentSpan`,
 * `extractTitle`, `extractTraits`, `harvestFields`, `harvestLinks`,
 * `detectPageType`) remain AON-shaped and are candidates for promotion to
 * strategies when a second source plugin surfaces a concrete need.
 */
export function extractCommon(
  root:     CheerioAPI,
  url:      string,
  strategy: CommonStrategy,
): CommonExtraction | null {
  const span = findContentSpan(root);
  if (span === null) return null;

  // Some monster pages wrap the stat block in an inner `<span class="monster-page">`.
  // Prefer it when present so we don't include adjacent layout chrome.
  const innerMonster = span.find('span.monster-page').first();
  const target = innerMonster.length > 0 ? innerMonster : span;

  const html = target.html() ?? '';
  const { head, body } = splitOnHr(html);

  const title    = extractTitle(root, target);
  const traits   = extractTraits(root, target);
  const sources  = strategy.sourceRef.extractSources(target, root);
  const source   = sources[0] ?? { book: null, page: null, source_id: null, raw: '' };
  const { fields, field_map } = harvestFields(head);
  const sections = strategy.sectionWalker.harvestSections(root, target);
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
export function getField(common: CommonExtraction, ...keys: string[]): string | null {
  for (const key of keys) {
    for (const fieldKey of Object.keys(common.field_map)) {
      if (fieldKey.toLowerCase() === key.toLowerCase()) return common.field_map[fieldKey]!;
    }
  }
  return null;
}

/** Same as getField, but returns the verbatim HTML value for richer parsing. */
export function getFieldHtml(common: CommonExtraction, ...keys: string[]): string | null {
  for (const key of keys) {
    for (const field of common.fields) {
      if (field.label.toLowerCase() === key.toLowerCase()) return field.value_html;
    }
  }
  return null;
}

/** Pull all matching field occurrences (some labels recur, e.g. Heightened). */
export function getAllFields(common: CommonExtraction, ...keys: string[]): HarvestedField[] {
  const lcKeys = keys.map((key) => key.toLowerCase());
  return common.fields.filter((field) => lcKeys.includes(field.label.toLowerCase()));
}

/** Tolerant signed integer parser — extracts the first `-?\d+` from a string. */
export function asInt(val: string | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  const match = /-?\d+/.exec(val);
  if (match === null) return null;
  const num = parseInt(match[0], 10);
  return Number.isFinite(num) ? num : null;
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
  for (const char of value) {
    if (char === '(' || char === '[' || char === '{') depth++;
    if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1);
    if (char === sep && depth === 0) {
      const trimmed = buf.trim();
      if (trimmed !== '') out.push(trimmed);
      buf = '';
      continue;
    }
    buf += char;
  }
  const trimmed = buf.trim();
  if (trimmed !== '') out.push(trimmed);
  return out;
}

/** Boilerplate cheerio loader for per-type unit tests. */
export function loadHtml(html: string): CheerioAPI {
  return load(html);
}

/**
 * The canonical capability output union — every extract/finalize node that
 * can soft-fail uses this. Terminal nodes (`flow:terminate`,
 * `aonprd:make-unknown`) and pure-assembly finalize nodes use `['success']`
 * inline instead.
 */
export const CAPABILITY_OUTPUTS = ['success', 'error'] as const;

/**
 * Load an HTML fragment wrapped in a `<div id="{rootId}">…</div>` shell.
 * Returns the wrapping CheerioAPI; the rootId lets callers anchor their queries
 * (e.g. `$h('#head-root b')`). Used by sub-fragment parsers in concept slice
 * helpers (`class.parseClassFeaturesProgression`, `familiar.parseSubAbilities`,
 * `monster.parseBareBoldAbilities`, and the shared `collectBareBoldBlocks`).
 */
export function loadFragment(html: string, rootId = 'fragment-root'): CheerioAPI {
  return load(`<div id="${rootId}">${html}</div>`);
}

// ─── Structural primitives (shared by capabilities + per-type extractors) ────

/**
 * Walk an HTML fragment and return the inner HTML of every
 * `<span class="hanging-indent">` in document order.
 *
 * Structural primitive — does not apply any domain filters (e.g. ability-name
 * validation, KNOWN_LABELS checks). Downstream code decides what to do with
 * each block.
 */
export function collectHangingIndentInners(html: string): string[] {
  const out: string[] = [];
  const openRe = /<span\s+class="hanging-indent">/gi;
  let openMatch: RegExpExecArray | null;
  while ((openMatch = openRe.exec(html)) !== null) {
    const start = openMatch.index + openMatch[0].length;
    let depth = 1;
    let pos = start;
    while (pos < html.length && depth > 0) {
      const open  = html.indexOf('<span', pos);
      const close = html.indexOf('</span>', pos);
      if (close === -1) break;
      if (open !== -1 && open < close) { depth++; pos = open + 5; }
      else {
        depth--;
        if (depth === 0) {
          out.push(html.slice(start, close));
          openRe.lastIndex = close + 7;
          break;
        }
        pos = close + 7;
      }
    }
  }
  return out;
}

/** A bare-bold block: a `<b>` whose text is plain (no child markup) followed by its value siblings. */
export interface BareBoldBlock {
  /** Text content of the `<b>` element, colon stripped. */
  name:       string;
  /** Rendered inner HTML of the sibling nodes following the `<b>` until the next boundary. */
  value_html: string;
}

/**
 * Walk an HTML fragment (the head section before the first `<hr/>`) and
 * return every `<b>Name</b> value` block whose `<b>` has no child markup and
 * is NOT inside:
 *   - `span.hanging-indent`
 *   - any `h1`, `h2`, `h3`
 *   - `a.monster-pwl-link`
 *   - `h2.hide-on-print` or `h3.hide-on-print`
 *
 * When the `<b>` is the sole child of an `<a>`, the sibling walk starts from
 * the anchor's next sibling (not the bold's).
 *
 * Structural primitive — does not apply `isAbilityName` / `isVariantOverlayJunk`
 * domain filters. Downstream capabilities add those.
 */
export function collectBareBoldBlocks(headHtml: string): BareBoldBlock[] {
  const out: BareBoldBlock[] = [];
  // AON occasionally emits double-bold wrappers `<b><b>Name</b></b>`.
  // Flatten before parsing so the inner `<b>` retains the value siblings it needs.
  const flattened = headHtml.replace(/<b>\s*<b>([^<]+)<\/b>\s*<\/b>/gi, '<b>$1</b>');
  const $frag = loadFragment(flattened, 'head-root');

  $frag('#head-root b').each((_index, element) => {
    const $bold = $frag(element);
    if ($bold.children().length > 0) return;                          // markup-in-name → skip
    if ($bold.parents('span.hanging-indent').length > 0) return;      // handled by hanging-indent block
    if ($bold.closest('h1, h2, h3').length > 0) return;               // heading chrome
    if ($bold.parents('a.monster-pwl-link').length > 0) return;
    if ($bold.parents('h2.hide-on-print, h3.hide-on-print').length > 0) return;

    const name = $bold.text().trim().replace(/:$/, '');
    if (name === '') return;

    // When the bold is the sole child of an anchor, value siblings are anchored
    // to the parent anchor's next, not the bold's.
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
    const value_html = valueNodes.map((node) => $frag.html(node as AnyNode)).join('');
    out.push({ name, value_html });
  });

  return out;
}

// ─── Shared section / PFS helpers ───────────────────────────

/**
 * Heading text patterns AON uses for legacy-content-warning sub-sections.
 *
 * These `<h3 class="title legacy-content-warning">` blocks are chrome, not
 * content. The `legacy: true` flag on the title extraction already carries
 * the same signal, so concept finalize nodes filter them out of `sections[]`.
 *
 * Single source of truth — 13 concept files previously redeclared this regex.
 */
export const LEGACY_HEADING_RE = /legacy[\s-]content[\s-]warning/i;

/**
 * Drop `<h3 class="title legacy-content-warning">` entries from a sections
 * array. Centralised here so every concept that surfaces `sections[]` in its
 * output applies the same filter.
 */
export function filterLegacySections(sections: readonly Section[]): Section[] {
  return sections.filter((sec) => !LEGACY_HEADING_RE.test(sec.heading));
}

/**
 * Extract the PFS Note text from a cheerio document.
 *
 * The AON HTML pattern (with browser-repaired tag soup):
 *   `<u><a href="PFS.aspx"><b><i>PFS Note</b></u></a> <body text> <br/>`
 *
 * Strategy: locate the `<a href="PFS.aspx">` anchor whose text contains
 * "PFS Note", then capture the trailing siblings up to the next `<br>` via a
 * tolerant regex over the rendered HTML (the cheerio tree for the malformed
 * markup is unreliable). Returns null when no PFS Note is present.
 *
 * Single source of truth — language, equipment, and weapon concepts previously
 * redeclared this helper.
 */
export function extractPfsNote(root: CheerioAPI, target: CheerioNode): string | null {
  let pfsAnchor: ReturnType<CheerioAPI> | null = null;

  target.find('a[href*="PFS.aspx"]').each((_index, element) => {
    if (pfsAnchor !== null) return;
    const text = root(element).text().replace(/\s+/g, ' ').trim();
    if (/PFS\s*Note/i.test(text)) {
      pfsAnchor = root(element);
    }
  });

  if (pfsAnchor === null) return null;

  const targetHtml = target.html() ?? '';
  const pfsRe = /PFS\.aspx[^>]*>[^<]*(?:<[^>]+>)*\s*PFS\s*Note[^<]*(?:<\/[^>]+>\s*)*([\s\S]*?)(?:<br\s*\/?>|$)/i;
  const pfsMatch = pfsRe.exec(targetHtml);
  if (pfsMatch === null) return null;

  const raw = pfsMatch[1] ?? '';
  const text = htmlToText(raw).trim();
  return text !== '' ? text : null;
}
