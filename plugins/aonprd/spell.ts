// Per-type extractor for AON spell + ritual pages. Builds a strongly-typed
// SpellOutput on top of the shared CommonExtraction surface.
import type { CheerioAPI } from 'cheerio';
import {
  type CommonExtraction, type CheerioNode, type ActionCost, type LinkRef,
  type Rarity, type PfsLegality, type SourceRef,
  getField, getFieldHtml, getAllFields, asInt, htmlToText, splitTopLevel, harvestLinks,
  extractEntityId, extractMetaDescription, extractMetaKeywords,
} from './common.js';

export type SpellKind = 'spell' | 'cantrip' | 'focus' | 'ritual';
export type Tradition = 'arcane' | 'divine' | 'occult' | 'primal' | 'elemental';

export interface SpellOutcome {
  critical_success: string | null;
  success: string | null;
  failure: string | null;
  critical_failure: string | null;
}

export interface AfflictionStage {
  stage: number;
  body_text: string;
  duration: string | null;
}

export interface Affliction {
  name: string;
  type: string | null;
  level: number | null;
  saving_throw: string | null;
  onset: string | null;
  maximum_duration: string | null;
  stages: AfflictionStage[];
  body_html: string;
}

export interface HeightenedEntry {
  rank_label: string;
  rank: number | null;
  increment: number | null;
  body_text: string;
  body_html: string;
}

export interface SpellOutput {
  _type: 'spell';
  url: string;
  /** Numeric AON ID extracted from the URL query string. */
  spell_id: number | null;
  name: string;
  kind: SpellKind;
  rank: number | null;
  rarity: Rarity;
  pfs: PfsLegality | null;
  legacy: boolean;
  alt_edition_url: string | null;
  action_cost: ActionCost | null;
  traits: string[];
  /** Trait AON IDs keyed by trait name (e.g. `{ "Necromancy": 117 }`). */
  trait_ids: Record<string, number>;
  source: { book: string | null; page: number | null; source_id: number | null };
  /** All source refs on the page (header + body footnotes). */
  sources: SourceRef[];
  traditions: Tradition[];
  spell_list: string | null;
  bloodlines: Array<{ name: string; bloodline_id: number | null }>;
  cult: Array<{ name: string; cult_id: number | null }>;
  domain: Array<{ name: string; domain_id: number | null }>;
  /**
   * Deities that grant this spell, from the `<b>Deities</b>` field.
   * Applies primarily to divine-granted spells and focus spells.
   */
  deities: Array<{ name: string; deity_id: number | null }>;
  /**
   * Oracle mysteries granting this spell, from the `<b>Mystery</b>` field.
   */
  mysteries: Array<{ name: string; mystery_id: number | null }>;
  /**
   * Witch patron themes granting this spell, from the `<b>Patron Theme</b>` field.
   */
  patron_themes: Array<{ name: string; patron_id: number | null }>;
  /**
   * Spell catalyst items, from the `<b>Catalysts</b>` field.
   */
  catalysts: Array<{ name: string; equipment_id: number | null }>;
  cast: { actions: ActionCost | null; components: string[]; time: string | null; raw: string | null };
  trigger: string | null;
  range: string | null;
  area: string | null;
  targets: string | null;
  /**
   * Remaster pages use `<b>Defense</b>` (e.g. "AC", "basic Fortitude").
   * Populated alongside `saving_throw` when both are present.
   */
  defense: string | null;
  saving_throw: { kind: string | null; basic: boolean; raw: string | null } | null;
  duration: string | null;
  cost: string | null;
  requirements: string | null;
  description_html: string;
  description_text: string;
  outcomes: SpellOutcome;
  affliction: Affliction | null;
  heightened: HeightenedEntry[];
  raw_fields: Record<string, string>;
  links: LinkRef[];
  /** `<meta name="description">` content. */
  meta_description: string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords: string | null;
}

const TRADITIONS: ReadonlySet<Tradition> = new Set(['arcane', 'divine', 'occult', 'primal', 'elemental']);

const ACTION_LABEL_MAP: ReadonlyMap<string, ActionCost> = new Map<string, ActionCost>([
  ['one-action', 'one-action'],
  ['single-action', 'one-action'],
  ['two-actions', 'two-actions'],
  ['three-actions', 'three-actions'],
  ['reaction', 'reaction'],
  ['free-action', 'free-action'],
]);

const ORDINAL_MAP: ReadonlyMap<string, number> = new Map<string, number>([
  ['1st', 1], ['2nd', 2], ['3rd', 3], ['4th', 4], ['5th', 5],
  ['6th', 6], ['7th', 7], ['8th', 8], ['9th', 9], ['10th', 10],
]);

/** Resolve the spell `kind` discriminator from a CommonExtraction title block. */
function resolveKind(c: CommonExtraction): SpellKind {
  const lk = (c.title.level_kind ?? '').toLowerCase();
  if (lk === 'cantrip') return 'cantrip';
  if (lk === 'focus') return 'focus';
  if (lk === 'ritual') return 'ritual';
  if (c.page_type === 'ritual') return 'ritual';
  return 'spell';
}

/** Lower-case + filter the Traditions field down to the canonical whitelist. */
function parseTraditions(c: CommonExtraction): Tradition[] {
  const raw = getField(c, 'Traditions', 'Tradition');
  if (raw === null) return [];
  const out: Tradition[] = [];
  for (const part of splitTopLevel(raw, ',')) {
    const lc = part.toLowerCase().trim();
    if (TRADITIONS.has(lc as Tradition)) out.push(lc as Tradition);
  }
  return out;
}

/** Extract `<a href="…aspx?ID=N">Name</a>` pairs from a value-html fragment. */
function parseRefList(html: string | null): Array<{ name: string; id: number | null }> {
  if (html === null) return [];
  const out: Array<{ name: string; id: number | null }> = [];
  const re = /<a[^>]*href="[^"]*\?ID=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const idStr = m[1] ?? '';
    const inner = m[2] ?? '';
    const name = htmlToText(inner);
    if (name === '') continue;
    const id = idStr === '' ? null : parseInt(idStr, 10);
    out.push({ name, id: Number.isFinite(id ?? NaN) ? id : null });
  }
  return out;
}

/** Extract refs filtered by aspx path from a field HTML value. */
function parseFilteredRefList(html: string | null, aspxPattern: RegExp): Array<{ name: string; id: number | null }> {
  if (html === null) return [];
  const out: Array<{ name: string; id: number | null }> = [];
  const re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1] ?? '';
    if (!aspxPattern.test(href)) continue;
    const idMatch = /\?ID=(\d+)/i.exec(href);
    const id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    const name = htmlToText(m[2] ?? '');
    if (name === '') continue;
    out.push({ name, id });
  }
  return out;
}

/** Pull aria-label tokens from any `<span class='action'>` glyph in a fragment. */
function parseActionCostFromHtml(html: string): ActionCost | null {
  const re = /<span\s+class=['"]action['"][^>]*aria-label=['"]([^'"]+)['"]/i;
  const m = re.exec(html);
  if (m === null) return null;
  const lc = (m[1] ?? '').toLowerCase().replace(/\s+/g, '-');
  return ACTION_LABEL_MAP.get(lc) ?? null;
}

/** Parse the heterogeneous `<b>Cast</b>` field — actions + components OR pure duration. */
function parseCast(c: CommonExtraction): SpellOutput['cast'] {
  const html = getFieldHtml(c, 'Cast');
  if (html === null) return { actions: null, components: [], time: null, raw: null };
  const actions = parseActionCostFromHtml(html);
  const components: string[] = [];
  const compRe = /<a[^>]*href="[^"]*Rules\.aspx\?ID=\d+[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let cm: RegExpExecArray | null;
  while ((cm = compRe.exec(html)) !== null) {
    const txt = htmlToText(cm[1] ?? '');
    if (txt !== '') components.push(txt.toLowerCase());
  }
  const text = htmlToText(html);
  // When no action glyph + no components, treat the raw text as a casting time.
  let time: string | null = null;
  if (actions === null && components.length === 0) {
    time = text === '' ? null : text;
  } else if (text !== '') {
    // Strip recognized component words to leave any trailing duration.
    let residual = text;
    for (const comp of components) {
      residual = residual.replace(new RegExp(`\\b${comp}\\b`, 'i'), '');
    }
    residual = residual.replace(/\[[a-z-]+\]/gi, '').replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();
    time = residual === '' ? null : residual;
  }
  return { actions, components, time, raw: text === '' ? null : text };
}

/** Saving Throw breakdown — strip leading "basic " marker and capture the kind. */
function parseSavingThrow(c: CommonExtraction): SpellOutput['saving_throw'] {
  const raw = getField(c, 'Saving Throw');
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const basic = /^basic\b/i.test(trimmed);
  const kind = basic ? trimmed.replace(/^basic\s+/i, '').trim() : trimmed;
  return { kind: kind === '' ? null : kind, basic, raw: trimmed };
}

/**
 * Parse the `<b>Defense</b>` field present on remaster spell pages.
 * Returns null when the field is absent.
 */
function parseDefense(c: CommonExtraction): string | null {
  const raw = getField(c, 'Defense');
  if (raw === null || raw.trim() === '') return null;
  return raw.trim();
}

/** Locate the first body boundary that ends the description prose. */
function findDescriptionBoundary(bodyHtml: string): number {
  const tierRe = /<b>\s*(?:Critical\s+Success|Success|Failure|Critical\s+Failure|Heightened)\s*(?:\([^)]*\))?\s*<\/b>/i;
  const tierM = tierRe.exec(bodyHtml);
  // Affliction marker: <b>NAME</b> (disease|poison|curse|...);<b>Level</b> N.
  const aff = findAfflictionStart(bodyHtml);
  const candidates: number[] = [];
  if (tierM !== null) candidates.push(tierM.index);
  if (aff !== null) candidates.push(aff.index);
  if (candidates.length === 0) return bodyHtml.length;
  return Math.min(...candidates);
}

interface AfflictionStart {
  index: number;
  end: number;
  name: string;
  type: string;
}

/** Find the inline `<b>Name</b> (type); <b>Level</b> N.` affliction header. */
function findAfflictionStart(html: string): AfflictionStart | null {
  const re = /<b>\s*([^<]+?)\s*<\/b>\s*\(([^)]+)\)\s*;\s*<b>\s*Level\s*<\/b>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const type = (m[2] ?? '').toLowerCase().trim();
    if (!/disease|poison|curse|venom|toxin|hex|infection|plague|affliction/.test(type)) continue;
    return { index: m.index, end: m.index + m[0].length, name: (m[1] ?? '').trim(), type };
  }
  return null;
}

/** Pull a single tier body — extends until the next tier / Heightened / `<hr/>` / end. */
function readTierBody(html: string, after: number): string {
  const stop = /<b>\s*(?:Critical\s+Success|Success|Failure|Critical\s+Failure|Heightened)\b|<hr\s*\/?>/i;
  const slice = html.slice(after);
  const m = stop.exec(slice);
  const end = m === null ? slice.length : m.index;
  return slice.slice(0, end);
}

/** Sweep the body for save-tier outcomes (`Critical Success` etc.). */
function parseOutcomes(bodyHtml: string): SpellOutcome {
  const labels: Array<{ key: keyof SpellOutcome; pattern: RegExp }> = [
    { key: 'critical_success', pattern: /<b>\s*Critical\s+Success\s*<\/b>/i },
    { key: 'success',          pattern: /<b>\s*Success\s*<\/b>/i },
    { key: 'failure',          pattern: /<b>\s*Failure\s*<\/b>/i },
    { key: 'critical_failure', pattern: /<b>\s*Critical\s+Failure\s*<\/b>/i },
  ];
  const out: SpellOutcome = { critical_success: null, success: null, failure: null, critical_failure: null };
  for (const { key, pattern } of labels) {
    const m = pattern.exec(bodyHtml);
    if (m === null) continue;
    const after = m.index + m[0].length;
    const body = readTierBody(bodyHtml, after);
    const text = htmlToText(body);
    out[key] = text === '' ? null : text;
  }
  return out;
}

/** Parse an affliction sub-entry into structured stages + optional metadata. */
function parseAffliction(bodyHtml: string): Affliction | null {
  const start = findAfflictionStart(bodyHtml);
  if (start === null) return null;
  // Affliction body extends until the first save-tier marker, Heightened, or end.
  const tail = bodyHtml.slice(start.end);
  const tierRe = /<b>\s*(?:Critical\s+Success|Success|Failure|Critical\s+Failure|Heightened)\b/i;
  const tierM = tierRe.exec(tail);
  const afflictionEnd = tierM === null ? bodyHtml.length : start.end + tierM.index;
  const block = bodyHtml.slice(start.index, afflictionEnd);

  const levelM = /<b>\s*Level\s*<\/b>\s*(\d+)/i.exec(block);
  const level = levelM === null ? null : asInt(levelM[1] ?? '');
  const saveM = /<b>\s*Saving\s+Throw\s*<\/b>\s*([^<;]+)/i.exec(block);
  const onsetM = /<b>\s*Onset\s*<\/b>\s*([^<;]+)/i.exec(block);
  const maxM = /<b>\s*Maximum\s+Duration\s*<\/b>\s*([^<;]+)/i.exec(block);

  const stages: AfflictionStage[] = [];
  const stageRe = /<b>\s*Stage\s+(\d+)\s*<\/b>/gi;
  const matches: Array<{ stage: number; index: number; end: number }> = [];
  let sm: RegExpExecArray | null;
  while ((sm = stageRe.exec(block)) !== null) {
    matches.push({ stage: parseInt(sm[1] ?? '0', 10), index: sm.index, end: sm.index + sm[0].length });
  }
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]!;
    const next = matches[i + 1];
    const end = next === undefined ? block.length : next.index;
    const seg = block.slice(cur.end, end);
    const text = htmlToText(seg).replace(/^[\s;]+/, '').replace(/[\s;]+$/, '');
    let duration: string | null = null;
    let body_text = text;
    const durM = /\(([^()]+)\)\s*[;.]?\s*$/.exec(text);
    if (durM !== null) {
      duration = (durM[1] ?? '').trim();
      body_text = text.slice(0, durM.index).trim().replace(/[;.]+$/, '').trim();
    }
    stages.push({ stage: cur.stage, body_text, duration });
  }

  return {
    name: start.name,
    type: start.type === '' ? null : start.type,
    level,
    saving_throw: saveM === null ? null : (saveM[1] ?? '').trim(),
    onset: onsetM === null ? null : (onsetM[1] ?? '').trim(),
    maximum_duration: maxM === null ? null : (maxM[1] ?? '').trim(),
    stages,
    body_html: block,
  };
}

/** Convert a heightened rank label like "5th" or "+2" to numeric rank/increment. */
function parseHeightenedLabel(label: string): { rank: number | null; increment: number | null } {
  const trimmed = label.trim();
  const incM = /^\+\s*(\d+)$/.exec(trimmed);
  if (incM !== null) {
    const n = parseInt(incM[1] ?? '', 10);
    return { rank: null, increment: Number.isFinite(n) ? n : null };
  }
  const ord = ORDINAL_MAP.get(trimmed.toLowerCase());
  if (ord !== undefined) return { rank: ord, increment: null };
  const numM = /^(\d+)/.exec(trimmed);
  if (numM !== null) {
    const n = parseInt(numM[1] ?? '', 10);
    return { rank: Number.isFinite(n) ? n : null, increment: null };
  }
  return { rank: null, increment: null };
}

/** Walk the body for every `<b>Heightened (LABEL)</b>` block in source order. */
function parseHeightened(bodyHtml: string, fields: CommonExtraction['fields']): HeightenedEntry[] {
  const out: HeightenedEntry[] = [];
  const re = /<b>\s*Heightened\s*\(([^)]+)\)\s*<\/b>/gi;
  const matches: Array<{ label: string; index: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(bodyHtml)) !== null) {
    matches.push({ label: (m[1] ?? '').trim(), index: m.index, end: m.index + m[0].length });
  }
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]!;
    const next = matches[i + 1];
    const end = next === undefined ? bodyHtml.length : next.index;
    const seg = bodyHtml.slice(cur.end, end);
    // Drop trailing decorative `<ul></ul>` placeholders.
    const cleaned = seg.replace(/<ul>\s*<\/ul>/gi, '').trim();
    const { rank, increment } = parseHeightenedLabel(cur.label);
    out.push({
      rank_label: cur.label,
      rank,
      increment,
      body_html: cleaned,
      body_text: htmlToText(cleaned),
    });
  }
  // Some pages place Heightened in header fields (rare; defensive).
  if (out.length === 0) {
    for (const f of fields) {
      if (!/^heightened\b/i.test(f.label)) continue;
      const labM = /\(([^)]+)\)/.exec(f.label);
      const label = labM === null ? f.label.replace(/^heightened\s*/i, '').trim() : (labM[1] ?? '').trim();
      const { rank, increment } = parseHeightenedLabel(label);
      out.push({
        rank_label: label,
        rank,
        increment,
        body_html: f.value_html,
        body_text: f.value_text,
      });
    }
  }
  return out;
}

/** Build a SpellOutput from the shared extraction surface — never throws. */
export function extractSpell(c: CommonExtraction, $: CheerioAPI, span: CheerioNode): SpellOutput {
  void span;
  const kind = resolveKind(c);
  const rank = c.title.level;

  const traditions = parseTraditions(c);
  const spell_list = getField(c, 'Spell List');
  const bloodlines = parseRefList(getFieldHtml(c, 'Bloodline', 'Bloodlines'))
    .map((r) => ({ name: r.name, bloodline_id: r.id }));
  const cult = parseRefList(getFieldHtml(c, 'Cult', 'Cults'))
    .map((r) => ({ name: r.name, cult_id: r.id }));
  const domain = parseRefList(getFieldHtml(c, 'Domain', 'Domains'))
    .map((r) => ({ name: r.name, domain_id: r.id }));

  // Remaster / extended spell fields
  const deities = parseFilteredRefList(getFieldHtml(c, 'Deities', 'Deity'), /Deities\.aspx/i)
    .map((r) => ({ name: r.name, deity_id: r.id }));
  const mysteries = parseFilteredRefList(getFieldHtml(c, 'Mystery', 'Mysteries'), /Mysteries\.aspx/i)
    .map((r) => ({ name: r.name, mystery_id: r.id }));
  const patron_themes = parseFilteredRefList(getFieldHtml(c, 'Patron Theme', 'Patron Themes'), /Patrons\.aspx/i)
    .map((r) => ({ name: r.name, patron_id: r.id }));
  const catalysts = parseFilteredRefList(getFieldHtml(c, 'Catalysts', 'Catalyst'), /Equipment\.aspx/i)
    .map((r) => ({ name: r.name, equipment_id: r.id }));

  const cast = parseCast(c);

  const bodyHtml = c.body_html;
  const descEnd = findDescriptionBoundary(bodyHtml);
  const description_html = bodyHtml.slice(0, descEnd).trim();
  const description_text = htmlToText(description_html);
  const outcomes = parseOutcomes(bodyHtml);
  const affliction = parseAffliction(bodyHtml);
  const heightened = parseHeightened(bodyHtml, c.fields);

  // Extra Heightened header occurrences are absorbed above; suppress unused-warn.
  void getAllFields;

  const out: SpellOutput = {
    _type: 'spell',
    url: c.url,
    spell_id: extractEntityId(c.url),
    name: c.title.name,
    kind,
    rank,
    rarity: c.traits.rarity,
    pfs: c.title.pfs,
    legacy: c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    action_cost: c.title.action_cost,
    traits: c.traits.traits,
    trait_ids: c.traits.trait_ids,
    source: { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources: c.sources,
    traditions,
    spell_list,
    bloodlines,
    cult,
    domain,
    deities,
    mysteries,
    patron_themes,
    catalysts,
    cast,
    trigger: getField(c, 'Trigger'),
    range: getField(c, 'Range'),
    area: getField(c, 'Area'),
    targets: getField(c, 'Targets'),
    defense: parseDefense(c),
    saving_throw: parseSavingThrow(c),
    duration: getField(c, 'Duration'),
    cost: getField(c, 'Cost'),
    requirements: getField(c, 'Requirements'),
    description_html,
    description_text,
    outcomes,
    affliction,
    heightened,
    raw_fields: { ...c.field_map },
    links: c.links.length > 0 ? c.links : harvestLinks(bodyHtml),
    meta_description: extractMetaDescription($),
    meta_keywords: extractMetaKeywords($),
  };
  return out;
}
