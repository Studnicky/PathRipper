// Weapon / Armor / Equipment extractors for AON (Archives of Nethys, 2e.aonprd.com).
// All three share the same header label/value harvest produced by common.ts;
// per-kind logic projects the typed columns (price parts, damage grammar,
// activations, tiered variant blocks, group anchors) on top of that scaffold.
import type { CheerioAPI } from 'cheerio';
import {
  type CommonExtraction, type CheerioNode, type ActionCost, type LinkRef,
  type Rarity, type PfsLegality, type SourceRef,
  getField, getFieldHtml, getAllFields, asInt, htmlToText, splitTopLevel, harvestLinks,
  extractEntityId, extractMetaDescription, extractMetaKeywords,
} from './common.js';

// ─── Output types ─────────────────────────────────────────────────────────────

export interface WeaponOutput {
  _type: 'weapon';
  url: string;
  /** Numeric AON ID extracted from the URL query string. */
  weapon_id: number | null;
  name: string;
  rarity: Rarity;
  pfs: PfsLegality | null;
  legacy: boolean;
  alt_edition_url: string | null;
  traits: string[];
  /** Trait AON IDs keyed by trait name. */
  trait_ids: Record<string, number>;
  source: { book: string | null; page: number | null; source_id: number | null };
  /** All source refs on the page (header + body footnotes). */
  sources: SourceRef[];
  favored_weapon: Array<{ deity: string; deity_id: number | null }>;
  price: { gp: number | null; sp: number | null; cp: number | null; raw: string | null };
  damage: { dice: string; type: 'B' | 'P' | 'S' | null; rider: string | null } | null;
  bulk: 'L' | number | null;
  hands: '1' | '2' | '1+' | null;
  reload: string | null;
  range: { feet: number } | null;
  ammunition: string | null;
  weapon_type: 'melee' | 'ranged' | null;
  category: 'unarmed' | 'simple' | 'martial' | 'advanced' | null;
  group: { name: string; group_id: number | null } | null;
  description_html: string;
  description_text: string;
  critical_specialization: { source: string | null; by_group: Record<string, string> } | null;
  specific_magic_weapons: Array<{ name: string; equipment_id: number | null }>;
  trait_glossary: Array<{ trait: string; description: string }>;
  raw_fields: Record<string, string>;
  links: LinkRef[];
  /** `<meta name="description">` content. */
  meta_description: string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords: string | null;
}

export interface ArmorOutput {
  _type: 'armor';
  url: string;
  /** Numeric AON ID extracted from the URL query string. */
  armor_id: number | null;
  name: string;
  rarity: Rarity;
  pfs: PfsLegality | null;
  legacy: boolean;
  alt_edition_url: string | null;
  traits: string[];
  /** Trait AON IDs keyed by trait name. */
  trait_ids: Record<string, number>;
  source: { book: string | null; page: number | null; source_id: number | null };
  /** All source refs on the page (header + body footnotes). */
  sources: SourceRef[];
  price: { gp: number | null; sp: number | null; cp: number | null; raw: string | null };
  ac_bonus: number | null;
  dex_cap: number | null;
  check_penalty: number | null;
  speed_penalty: number | null;
  strength: number | null;
  bulk: 'L' | number | null;
  category: 'unarmored' | 'light' | 'medium' | 'heavy' | null;
  group: { name: string; group_id: number | null } | null;
  description_html: string;
  description_text: string;
  raw_fields: Record<string, string>;
  links: LinkRef[];
  /** `<meta name="description">` content. */
  meta_description: string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords: string | null;
}

export interface EquipmentVariant {
  name: string;
  item_level: number | null;
  source: { book: string | null; page: number | null; source_id: number | null };
  price: { gp: number | null; sp: number | null; cp: number | null; raw: string | null };
  bulk: 'L' | number | null;
  description_text: string;
}

export interface Activation {
  action_cost: ActionCost | null;
  components: string[];
  text: string | null;
}

export interface EquipmentOutput {
  _type: 'equipment';
  url: string;
  /** Numeric AON ID extracted from the URL query string. */
  equipment_id: number | null;
  name: string;
  item_level: number | null;
  tiered_variants: boolean;
  rarity: Rarity;
  pfs: PfsLegality | null;
  legacy: boolean;
  alt_edition_url: string | null;
  traits: string[];
  /** Trait AON IDs keyed by trait name. */
  trait_ids: Record<string, number>;
  source: { book: string | null; page: number | null; source_id: number | null };
  /** All source refs on the page (header + body footnotes). */
  sources: SourceRef[];
  price: { gp: number | null; sp: number | null; cp: number | null; raw: string | null };
  bulk: 'L' | number | null;
  usage: string | null;
  hands: string | null;
  activations: Activation[];
  frequency: string | null;
  trigger: string | null;
  requirements: string | null;
  effect: string | null;
  onset: string | null;
  duration: string | null;
  craft_requirements: string | null;
  access: string | null;
  benefit: string | null;
  drawback: string | null;
  cost: string | null;
  saving_throw: string | null;
  description_html: string;
  description_text: string;
  variants: EquipmentVariant[];
  raw_fields: Record<string, string>;
  links: LinkRef[];
  /** `<meta name="description">` content. */
  meta_description: string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords: string | null;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

const DASH_RE = /^(?:—|–|-|&mdash;|&ndash;)$/;

function isDash(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const t = value.trim();
  return t === '' || DASH_RE.test(t);
}

function dashToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '' || DASH_RE.test(trimmed)) return null;
  return trimmed;
}

interface PriceParts {
  gp: number | null; sp: number | null; cp: number | null; raw: string | null;
}

/** Parse a price string like `1 gp, 5 sp` into structured coin counts. */
function parsePrice(raw: string | null): PriceParts {
  if (raw === null || isDash(raw)) return { gp: null, sp: null, cp: null, raw: null };
  const text = raw.trim();
  // Allow comma-separated numerals like "3,000 gp".
  let gp: number | null = null, sp: number | null = null, cp: number | null = null;
  const re = /([\d,]+)\s*(gp|sp|cp)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = parseInt((m[1] ?? '').replace(/,/g, ''), 10);
    if (!Number.isFinite(n)) continue;
    const unit = (m[2] ?? '').toLowerCase();
    if (unit === 'gp') gp = n;
    else if (unit === 'sp') sp = n;
    else if (unit === 'cp') cp = n;
  }
  return { gp, sp, cp, raw: text };
}

/** Bulk: 'L' literal, integer numeric, or null on em-dash. */
function parseBulk(raw: string | null): 'L' | number | null {
  if (raw === null || isDash(raw)) return null;
  const t = raw.trim();
  if (/^L$/i.test(t)) return 'L';
  const n = asInt(t);
  return n;
}

interface DamageParts {
  dice: string; type: 'B' | 'P' | 'S' | null; rider: string | null;
}

/** Parse `1d8 S`, `1d4 P plus 1d4 fire`, etc. Em-dash → null. */
function parseDamage(raw: string | null): DamageParts | null {
  if (raw === null || isDash(raw)) return null;
  const t = raw.trim();
  // Dice token + optional damage type + optional rider tail.
  const m = /^(\d+d\d+(?:\s*[+\-]\s*\d+)?)\s*([BPS])?\s*(.*)$/i.exec(t);
  if (m === null) return null;
  const dice = (m[1] ?? '').replace(/\s+/g, '');
  const typeToken = (m[2] ?? '').toUpperCase();
  const type: 'B' | 'P' | 'S' | null = typeToken === 'B' || typeToken === 'P' || typeToken === 'S' ? typeToken : null;
  const riderRaw = (m[3] ?? '').trim();
  const rider = riderRaw === '' ? null : riderRaw;
  return { dice, type, rider };
}

/** Parse `30 feet` → `{feet:30}`; em-dash → null. */
function parseRange(raw: string | null): { feet: number } | null {
  if (raw === null || isDash(raw)) return null;
  const m = /(\d+)\s*feet/i.exec(raw);
  if (m === null) return null;
  const n = parseInt(m[1]!, 10);
  return Number.isFinite(n) ? { feet: n } : null;
}

/** Parse trait-entry glossary blocks (`<div class="trait-entry">`). */
function parseTraitGlossary($: CheerioAPI, span: CheerioNode): Array<{ trait: string; description: string }> {
  const out: Array<{ trait: string; description: string }> = [];
  span.find('div.trait-entry').each((_, el) => {
    const html = $(el).html() ?? '';
    const m = /<b>\s*([^<]+?)\s*<\/b>([\s\S]*)/i.exec(html);
    if (m === null) return;
    const trait = (m[1] ?? '').replace(/:$/, '').trim();
    const description = htmlToText(m[2] ?? '');
    if (trait === '') return;
    out.push({ trait, description });
  });
  return out;
}

/** Slice a description: body before the first `<h2 class="title">` subsection. */
function buildDescription(bodyHtml: string): { html: string; text: string } {
  const m = /<h2\s+class="title"/i.exec(bodyHtml);
  const before = m === null ? bodyHtml : bodyHtml.slice(0, m.index);
  return { html: before.trim(), text: htmlToText(before) };
}

/** Find the AON anchor href + id pair embedded in a field's HTML value. */
function readGroupAnchor(valueHtml: string | null, kindHint: RegExp): { name: string; group_id: number | null } | null {
  if (valueHtml === null) return null;
  if (isDash(htmlToText(valueHtml))) return null;
  const m = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(valueHtml);
  if (m === null) {
    // Plain-text group fallback.
    const txt = htmlToText(valueHtml);
    return txt === '' ? null : { name: txt, group_id: null };
  }
  const href = m[1] ?? '';
  if (!kindHint.test(href)) {
    const txt = htmlToText(valueHtml);
    return txt === '' ? null : { name: txt, group_id: null };
  }
  const idMatch = /\?ID=(\d+)/i.exec(href);
  const group_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
  const name = htmlToText(m[2] ?? '');
  return { name, group_id };
}

const ACTION_GLYPH_RE = /\[([a-z-]+)\]/i;

const ACTION_LABEL_TO_COST: ReadonlyMap<string, ActionCost> = new Map<string, ActionCost>([
  ['one-action',     'one-action'],
  ['single-action',  'one-action'],
  ['two-actions',    'two-actions'],
  ['three-actions',  'three-actions'],
  ['reaction',       'reaction'],
  ['free-action',    'free-action'],
]);

/** Parse `Activate` field HTML for action glyphs and `(component, …)` lists. */
function parseActivation(valueHtml: string): Activation {
  // Action glyph (first occurrence wins, additional glyphs imply variable cost).
  const glyphRe = /<span\s+class=['"]action['"][^>]*>([\s\S]*?)<\/span>/gi;
  let glyphMatch: RegExpExecArray | null;
  const costs: ActionCost[] = [];
  while ((glyphMatch = glyphRe.exec(valueHtml)) !== null) {
    const inner = glyphMatch[1] ?? '';
    const lm = ACTION_GLYPH_RE.exec(inner);
    if (lm === null) continue;
    const cost = ACTION_LABEL_TO_COST.get((lm[1] ?? '').toLowerCase());
    if (cost !== undefined) costs.push(cost);
  }
  let action_cost: ActionCost | null = null;
  if (costs.length === 1) action_cost = costs[0]!;
  else if (costs.length > 1) action_cost = 'variable';

  // Components in trailing parentheses, e.g. `(manipulate, command)`.
  const components: string[] = [];
  const compMatch = /\(([^()]+)\)/.exec(htmlToText(valueHtml));
  if (compMatch !== null) {
    for (const part of splitTopLevel(compMatch[1] ?? '', ',')) {
      const lc = part.toLowerCase().replace(/\s+/g, ' ').trim();
      if (lc !== '') components.push(lc);
    }
  }

  // Free-form remainder text (sans glyphs and parens) — null when nothing left.
  const noGlyphs = valueHtml.replace(/<span\s+class=['"]action['"][\s\S]*?<\/span>/gi, '');
  const noParens = htmlToText(noGlyphs).replace(/\([^()]*\)/g, '').replace(/\s+/g, ' ').trim();
  const text = noParens === '' ? null : noParens;

  return { action_cost, components, text };
}

/** Parse `Favored Weapon` field for deity links. */
function parseFavoredWeapon(valueHtml: string | null): Array<{ deity: string; deity_id: number | null }> {
  if (valueHtml === null) return [];
  const out: Array<{ deity: string; deity_id: number | null }> = [];
  const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(valueHtml)) !== null) {
    const href = m[1] ?? '';
    if (!/Deities\.aspx/i.test(href)) continue;
    const idMatch = /\?ID=(\d+)/i.exec(href);
    const deity_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    const deity = htmlToText(m[2] ?? '');
    if (deity === '') continue;
    out.push({ deity, deity_id });
  }
  return out;
}

/** Parse weapon Critical Specialization Effects subsection. */
function parseCriticalSpec(c: CommonExtraction): { source: string | null; by_group: Record<string, string> } | null {
  const section = c.sections.find((s) => /^Critical Specialization Effects$/i.test(s.heading));
  if (section === undefined) return null;
  const html = section.body_html;
  // Source label pulled into its own slot.
  const sourceMatch = /<b>\s*Source\s*<\/b>\s*<a[^>]*>\s*<i>([^<]+)<\/i>\s*<\/a>(?:\s*pg\.\s*\d+)?/i.exec(html);
  const source = sourceMatch !== null ? (sourceMatch[1] ?? '').trim() : null;
  // Group-keyed lines: `<b>Brawling</b>: text`.
  const by_group: Record<string, string> = {};
  const groupRe = /<b>\s*([^<]+?)\s*<\/b>\s*:?\s*([^<]*(?:<a[^>]*>[^<]*<\/a>[^<]*)*)/gi;
  let m: RegExpExecArray | null;
  while ((m = groupRe.exec(html)) !== null) {
    const label = (m[1] ?? '').trim();
    if (/^source$/i.test(label)) continue;
    const valueText = htmlToText(m[2] ?? '');
    if (label === '' || valueText === '') continue;
    if (!(label in by_group)) by_group[label] = valueText;
  }
  return { source, by_group };
}

/** Parse Specific Magic Weapons subsection (anchor list). */
function parseSpecificMagicWeapons(c: CommonExtraction): Array<{ name: string; equipment_id: number | null }> {
  const section = c.sections.find((s) => /^Specific Magic Weapons$/i.test(s.heading));
  if (section === undefined) return [];
  const out: Array<{ name: string; equipment_id: number | null }> = [];
  for (const link of section.links) {
    if (!/Equipment\.aspx/i.test(link.href)) continue;
    out.push({ name: link.text, equipment_id: link.id });
  }
  return out;
}

// ─── Weapon ───────────────────────────────────────────────────────────────────

const CATEGORY_WEAPON: ReadonlyMap<string, 'unarmed' | 'simple' | 'martial' | 'advanced'> = new Map([
  ['unarmed', 'unarmed'],
  ['simple', 'simple'],
  ['martial', 'martial'],
  ['advanced', 'advanced'],
]);

function parseWeaponHands(raw: string | null): '1' | '2' | '1+' | null {
  if (raw === null || isDash(raw)) return null;
  const t = raw.trim();
  if (t === '1') return '1';
  if (t === '2') return '2';
  if (t === '1+' || /^1\s*\+/.test(t)) return '1+';
  return null;
}

/** Project a CommonExtraction of a Weapons.aspx page into a typed WeaponOutput. */
export function extractWeapon(c: CommonExtraction, $: CheerioAPI, span: CheerioNode): WeaponOutput {
  const description = buildDescription(c.body_html);
  const groupHtml = getFieldHtml(c, 'Group');
  const group = readGroupAnchor(groupHtml, /WeaponGroups\.aspx/i);

  const typeRaw = getField(c, 'Type');
  let weapon_type: 'melee' | 'ranged' | null = null;
  if (typeRaw !== null) {
    const lc = typeRaw.toLowerCase().trim();
    if (lc === 'melee') weapon_type = 'melee';
    else if (lc === 'ranged') weapon_type = 'ranged';
  }

  const categoryRaw = getField(c, 'Category');
  const category = categoryRaw !== null
    ? CATEGORY_WEAPON.get(categoryRaw.toLowerCase().trim()) ?? null
    : null;

  return {
    _type: 'weapon',
    url: c.url,
    weapon_id: extractEntityId(c.url),
    name: c.title.name,
    rarity: c.traits.rarity,
    pfs: c.title.pfs,
    legacy: c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    traits: c.traits.traits,
    trait_ids: c.traits.trait_ids,
    source: { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources: c.sources,
    favored_weapon: parseFavoredWeapon(getFieldHtml(c, 'Favored Weapon')),
    price: parsePrice(getField(c, 'Price')),
    damage: parseDamage(getField(c, 'Damage')),
    bulk: parseBulk(getField(c, 'Bulk')),
    hands: parseWeaponHands(getField(c, 'Hands')),
    reload: dashToNull(getField(c, 'Reload')),
    range: parseRange(getField(c, 'Range')),
    ammunition: dashToNull(getField(c, 'Ammunition')),
    weapon_type,
    category,
    group,
    description_html: description.html,
    description_text: description.text,
    critical_specialization: parseCriticalSpec(c),
    specific_magic_weapons: parseSpecificMagicWeapons(c),
    trait_glossary: parseTraitGlossary($, span),
    raw_fields: { ...c.field_map },
    links: harvestLinks(c.body_html).length > 0 ? harvestLinks(c.body_html) : c.links,
    meta_description: extractMetaDescription($),
    meta_keywords: extractMetaKeywords($),
  };
}

// ─── Armor ────────────────────────────────────────────────────────────────────

const CATEGORY_ARMOR: ReadonlyMap<string, 'unarmored' | 'light' | 'medium' | 'heavy'> = new Map([
  ['unarmored', 'unarmored'],
  ['light',     'light'],
  ['medium',    'medium'],
  ['heavy',     'heavy'],
]);

/** Project a CommonExtraction of an Armor.aspx page into a typed ArmorOutput. */
export function extractArmor(c: CommonExtraction, $: CheerioAPI, span: CheerioNode): ArmorOutput {
  void $; void span;
  const description = buildDescription(c.body_html);
  const groupHtml = getFieldHtml(c, 'Group');
  const group = readGroupAnchor(groupHtml, /ArmorGroups\.aspx/i);

  const categoryRaw = getField(c, 'Category');
  const category = categoryRaw !== null
    ? CATEGORY_ARMOR.get(categoryRaw.toLowerCase().trim()) ?? null
    : null;

  return {
    _type: 'armor',
    url: c.url,
    armor_id: extractEntityId(c.url),
    name: c.title.name,
    rarity: c.traits.rarity,
    pfs: c.title.pfs,
    legacy: c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    traits: c.traits.traits,
    trait_ids: c.traits.trait_ids,
    source: { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources: c.sources,
    price: parsePrice(getField(c, 'Price')),
    ac_bonus:      asInt(dashToNull(getField(c, 'AC Bonus'))),
    dex_cap:       asInt(dashToNull(getField(c, 'Dex Cap'))),
    check_penalty: asInt(dashToNull(getField(c, 'Check Penalty'))),
    speed_penalty: asInt(dashToNull(getField(c, 'Speed Penalty'))),
    strength:      asInt(dashToNull(getField(c, 'Strength'))),
    bulk: parseBulk(getField(c, 'Bulk')),
    category,
    group,
    description_html: description.html,
    description_text: description.text,
    raw_fields: { ...c.field_map },
    links: harvestLinks(c.body_html).length > 0 ? harvestLinks(c.body_html) : c.links,
    meta_description: extractMetaDescription($),
    meta_keywords: extractMetaKeywords($),
  };
}

// ─── Equipment ────────────────────────────────────────────────────────────────

const VARIANT_HEADING_RE = /\((Lesser|Moderate|Greater|Major)\)/i;

/** Walk variant `<h2 class="title">Name (Lesser/…)</h2>` blocks within the body. */
function parseVariants(c: CommonExtraction): EquipmentVariant[] {
  const out: EquipmentVariant[] = [];
  for (const section of c.sections) {
    if (!VARIANT_HEADING_RE.test(section.heading)) continue;
    // Extract item-level marker (`Item N`) from the heading text.
    const lvlMatch = /Item\s+(-?\d+)/i.exec(section.heading);
    const item_level = lvlMatch !== null ? parseInt(lvlMatch[1]!, 10) : null;
    const cleanName = section.heading.replace(/Item\s+-?\d+\+?/i, '').trim();

    // Harvest header-style fields out of the body HTML for this variant.
    const html = section.body_html;
    const sourceMatch = /<b>\s*Source\s*<\/b>\s*<a[^>]*href="[^"]*Sources\.aspx\?ID=(\d+)"[^>]*>\s*<i>([^<]+)<\/i>\s*<\/a>/i.exec(html);
    let source_id: number | null = null;
    let book: string | null = null;
    let page: number | null = null;
    if (sourceMatch !== null) {
      source_id = parseInt(sourceMatch[1]!, 10);
      const raw = sourceMatch[2] ?? '';
      const pgMatch = /^(.*?)\s*pg\.\s*(\d+)/i.exec(raw);
      if (pgMatch !== null) {
        book = (pgMatch[1] ?? '').trim();
        const n = parseInt(pgMatch[2]!, 10);
        page = Number.isFinite(n) ? n : null;
      } else {
        book = raw.trim();
      }
    }

    const priceMatch = /<b>\s*Price\s*<\/b>\s*([^<]+?)(?=<br|<b|$)/i.exec(html);
    const priceRaw = priceMatch !== null ? htmlToText(priceMatch[1] ?? '') : null;

    const bulkMatch = /<b>\s*Bulk\s*<\/b>\s*([^<]+?)(?=<br|<b|$)/i.exec(html);
    const bulkRaw = bulkMatch !== null ? htmlToText(bulkMatch[1] ?? '') : null;

    // Description = body HTML with leading label lines stripped.
    const stripped = html.replace(/<b>\s*(?:Source|Price|Bulk)\s*<\/b>[\s\S]*?<br\s*\/?>/gi, '');
    const description_text = htmlToText(stripped);

    out.push({
      name: cleanName,
      item_level,
      source: { book, page, source_id },
      price: parsePrice(priceRaw),
      bulk: parseBulk(bulkRaw),
      description_text,
    });
  }
  return out;
}

/** Build the prose description for equipment, dropping inline label paragraphs. */
function buildEquipmentDescription(bodyHtml: string): { html: string; text: string } {
  const subIdx = /<h2\s+class="title"/i.exec(bodyHtml);
  const before = subIdx === null ? bodyHtml : bodyHtml.slice(0, subIdx.index);
  // Strip inline `<b>Label</b> …` paragraphs that we already projected.
  const INLINE_LABELS = /(?:Frequency|Trigger|Requirements|Effect|Onset|Duration|Craft Requirements|Access|Benefit|Drawback|Cost|Saving Throw|Activate|Usage|Hands)/i;
  const stripped = before.replace(
    new RegExp(`<b>\\s*${INLINE_LABELS.source}\\s*</b>[\\s\\S]*?(?=<b>|<h2|<h3|<br\\s*/?>\\s*<br|$)`, 'gi'),
    '',
  );
  return { html: stripped.trim(), text: htmlToText(stripped) };
}

/** Project a CommonExtraction of an Equipment.aspx page into a typed EquipmentOutput. */
export function extractEquipment(c: CommonExtraction, $: CheerioAPI, span: CheerioNode): EquipmentOutput {
  void $; void span;
  // Activations: walk every Activate field (may repeat).
  const activateFields = getAllFields(c, 'Activate');
  const activations: Activation[] = activateFields.map((f) => parseActivation(f.value_html));

  // Inline body labels (Effect/Benefit/Drawback/etc. live inside body, not header).
  const bodyHtml = c.body_html;
  const grabInline = (label: string): string | null => {
    const re = new RegExp(`<b>\\s*${label}\\s*</b>([\\s\\S]*?)(?=<b>|<h2|<h3|$)`, 'i');
    const m = re.exec(bodyHtml);
    if (m === null) return null;
    const text = htmlToText(m[1] ?? '');
    return text === '' ? null : text;
  };

  // Description = body before subsections, with already-projected inline labels stripped.
  const description = buildEquipmentDescription(bodyHtml);

  return {
    _type: 'equipment',
    url: c.url,
    equipment_id: extractEntityId(c.url),
    name: c.title.name,
    item_level: c.title.level,
    tiered_variants: c.title.tiered,
    rarity: c.traits.rarity,
    pfs: c.title.pfs,
    legacy: c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    traits: c.traits.traits,
    trait_ids: c.traits.trait_ids,
    source: { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources: c.sources,
    price: parsePrice(getField(c, 'Price')),
    bulk: parseBulk(getField(c, 'Bulk')),
    usage: dashToNull(getField(c, 'Usage')),
    hands: dashToNull(getField(c, 'Hands')),
    activations,
    frequency:    dashToNull(getField(c, 'Frequency'))    ?? grabInline('Frequency'),
    trigger:      dashToNull(getField(c, 'Trigger'))      ?? grabInline('Trigger'),
    requirements: dashToNull(getField(c, 'Requirements')) ?? grabInline('Requirements'),
    effect:       dashToNull(getField(c, 'Effect'))       ?? grabInline('Effect'),
    onset:        dashToNull(getField(c, 'Onset'))        ?? grabInline('Onset'),
    duration:     dashToNull(getField(c, 'Duration'))     ?? grabInline('Duration'),
    craft_requirements: dashToNull(getField(c, 'Craft Requirements')) ?? grabInline('Craft Requirements'),
    access:       dashToNull(getField(c, 'Access'))       ?? grabInline('Access'),
    benefit:      dashToNull(getField(c, 'Benefit'))      ?? grabInline('Benefit'),
    drawback:     dashToNull(getField(c, 'Drawback'))     ?? grabInline('Drawback'),
    cost:         dashToNull(getField(c, 'Cost'))         ?? grabInline('Cost'),
    saving_throw: dashToNull(getField(c, 'Saving Throw')) ?? grabInline('Saving Throw'),
    description_html: description.html,
    description_text: description.text,
    variants: parseVariants(c),
    raw_fields: { ...c.field_map },
    links: harvestLinks(c.body_html).length > 0 ? harvestLinks(c.body_html) : c.links,
    meta_description: extractMetaDescription($),
    meta_keywords: extractMetaKeywords($),
  };
}
