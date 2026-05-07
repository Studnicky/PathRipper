// Feat extractor for AON (Archives of Nethys, 2e.aonprd.com).
// Consumes the shared CommonExtraction and projects a strongly typed Feat
// shape, including archetype links, the "Leads To" subsection, and the
// in-page Traits glossary block.
import type { CheerioAPI } from 'cheerio';
import {
  type CommonExtraction, type CheerioNode, type ActionCost, type LinkRef,
  type Rarity, type PfsLegality, type SourceRef,
  getField, getFieldHtml, htmlToText, harvestLinks,
  extractEntityId, extractMetaDescription, extractMetaKeywords,
} from './common.js';

// ─── Output shape ─────────────────────────────────────────────────────────────

export interface FeatOutput {
  _type: 'feat';
  url: string;
  /** Numeric AON ID extracted from the URL query string. */
  feat_id: number | null;
  name: string;
  level: number | null;
  rarity: Rarity;
  pfs: PfsLegality | null;
  legacy: boolean;
  alt_edition_url: string | null;
  action_cost: ActionCost | null;
  traits: string[];
  /** Trait AON IDs keyed by trait name (e.g. `{ "Dwarf": 52 }`). */
  trait_ids: Record<string, number>;
  source: { book: string | null; page: number | null; source_id: number | null };
  /** All source refs on the page (header + body footnotes). */
  sources: SourceRef[];
  archetypes: Array<{ name: string; archetype_id: number | null }>;
  archetype_footnotes: string[];
  prerequisites: string | null;
  frequency: string | null;
  trigger: string | null;
  requirements: string | null;
  cost: string | null;
  access: string | null;
  /** True when the feat carries a "Mythic" level-kind marker or Mythic trait. */
  is_mythic: boolean;
  description_html: string;
  description_text: string;
  special: string | null;
  leads_to: Array<{ name: string; feat_id: number | null }>;
  /** Related feats listed in the `<b>Related Feats</b>` inline field. */
  related_feats: Array<{ name: string; feat_id: number | null }>;
  trait_glossary: Array<{ trait: string; description: string }>;
  raw_fields: Record<string, string>;
  links: LinkRef[];
  /** `<meta name="description">` content. */
  meta_description: string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DASH_RE = /^(?:—|–|-|&mdash;|&ndash;)$/;

/** Treat em-dash / en-dash / hyphen sentinel values as null. */
function dashToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (DASH_RE.test(trimmed)) return null;
  return trimmed;
}

/** Extract `<b>Special</b>` paragraph text from the body HTML, if present. */
function extractSpecial(bodyHtml: string): string | null {
  const m = /<b>\s*Special\s*<\/b>([\s\S]*?)(?=<b>|<h2|<h3|$)/i.exec(bodyHtml);
  if (m === null) return null;
  const text = htmlToText(m[1] ?? '');
  return text === '' ? null : text;
}

/** Build the prose description, stripping out the `<b>Special</b>` paragraph. */
function buildDescription(bodyHtml: string): { html: string; text: string } {
  const subIdx = /<h2\s+class="title"/i.exec(bodyHtml);
  const before = subIdx === null ? bodyHtml : bodyHtml.slice(0, subIdx.index);
  const stripped = before.replace(/<b>\s*Special\s*<\/b>[\s\S]*?(?=<b>|<h2|<h3|$)/i, '');
  return { html: stripped.trim(), text: htmlToText(stripped) };
}

/** Parse the Archetype/Archetypes field into structured refs. */
function parseArchetypes(valueHtml: string | null): Array<{ name: string; archetype_id: number | null }> {
  if (valueHtml === null) return [];
  const out: Array<{ name: string; archetype_id: number | null }> = [];
  const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(valueHtml)) !== null) {
    const href = m[1] ?? '';
    if (!/Archetypes\.aspx/i.test(href)) continue;
    const idMatch = /\?ID=(\d+)/i.exec(href);
    const archetype_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    const name = htmlToText(m[2] ?? '');
    if (name === '') continue;
    out.push({ name, archetype_id });
  }
  return out;
}

/** Capture archetype footnote lines (e.g. `* This archetype offers …`). */
function parseArchetypeFootnotes(headHtml: string): string[] {
  const out: string[] = [];
  const segments = headHtml.split(/<br\s*\/?>/i);
  for (const seg of segments) {
    const text = htmlToText(seg);
    if (text.startsWith('*')) {
      const trimmed = text.slice(1).trim();
      if (trimmed !== '') out.push(trimmed);
    }
  }
  return out;
}

/** Find the `<h2 class="title">… Leads To...</h2>` section and harvest its anchor list. */
function parseLeadsTo(c: CommonExtraction): Array<{ name: string; feat_id: number | null }> {
  const out: Array<{ name: string; feat_id: number | null }> = [];
  const section = c.sections.find((s) => /Leads To\.{2,3}\s*$/i.test(s.heading));
  if (section === undefined) return out;
  for (const link of section.links) {
    if (!/Feats\.aspx/i.test(link.href)) continue;
    out.push({ name: link.text, feat_id: link.id });
  }
  return out;
}

/**
 * Parse the inline `<b>Related Feats</b>: …` field.
 * This field may appear in either the head section or the body (after `<hr />`).
 */
function parseRelatedFeats(fullHtml: string): Array<{ name: string; feat_id: number | null }> {
  // Capture from the <b>Related Feats</b> marker up to the next <b> or <br/><br/> gap.
  const m = /<b>\s*Related Feats\s*<\/b>\s*:?\s*([\s\S]*?)(?=<br\s*\/?>[\s\S]{0,4}<br\s*\/?>|<b>|<h[1-6]|$)/i.exec(fullHtml);
  if (m === null) return [];
  const fragment = m[1] ?? '';
  const out: Array<{ name: string; feat_id: number | null }> = [];
  const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let am: RegExpExecArray | null;
  while ((am = anchorRe.exec(fragment)) !== null) {
    const href = am[1] ?? '';
    if (!/Feats\.aspx/i.test(href)) continue;
    const idMatch = /\?ID=(\d+)/i.exec(href);
    const feat_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    const name = htmlToText(am[2] ?? '');
    if (name === '') continue;
    out.push({ name, feat_id });
  }
  return out;
}

/** Find `<h2 class="title">Traits</h2>` and harvest the `<div class="trait-entry">` glossary. */
function parseTraitGlossary($: CheerioAPI, span: CheerioNode): Array<{ trait: string; description: string }> {
  const out: Array<{ trait: string; description: string }> = [];
  span.find('div.trait-entry').each((_, el) => {
    const html = $(el).html() ?? '';
    const labelMatch = /<b>\s*([^<]+?)\s*<\/b>([\s\S]*)/i.exec(html);
    if (labelMatch === null) return;
    const trait = (labelMatch[1] ?? '').replace(/:$/, '').trim();
    const description = htmlToText(labelMatch[2] ?? '');
    if (trait === '') return;
    out.push({ trait, description });
  });
  return out;
}

/** Slice the head HTML (before the first `<hr />`) out of the content span. */
function readHeadHtml(span: CheerioNode): string {
  const html = span.html() ?? '';
  const m = /<hr\s*\/?>/i.exec(html);
  return m === null ? html : html.slice(0, m.index);
}

// ─── Public extractor ─────────────────────────────────────────────────────────

/** Project a CommonExtraction of a Feats.aspx page into a typed FeatOutput. */
export function extractFeat(c: CommonExtraction, $: CheerioAPI, span: CheerioNode): FeatOutput {
  const archetypeHtml = getFieldHtml(c, 'Archetype', 'Archetypes');
  const archetypes = parseArchetypes(archetypeHtml);
  const headHtml = readHeadHtml(span);
  const archetype_footnotes = parseArchetypeFootnotes(headHtml);

  const description = buildDescription(c.body_html);
  const special = extractSpecial(c.body_html);
  const leads_to = parseLeadsTo(c);
  // Related Feats may appear in the head or the body depending on the page.
  const fullHtml = span.html() ?? '';
  const related_feats = parseRelatedFeats(fullHtml);
  const trait_glossary = parseTraitGlossary($, span);

  const bodyLinks = harvestLinks(c.body_html);

  // Detect mythic feats: level_kind is "Mythic" or traits include "Mythic".
  const is_mythic =
    (c.title.level_kind ?? '').toLowerCase() === 'mythic' ||
    c.traits.traits.some((t) => t.toLowerCase() === 'mythic');

  return {
    _type: 'feat',
    url: c.url,
    feat_id: extractEntityId(c.url),
    name: c.title.name,
    level: c.title.level,
    rarity: c.traits.rarity,
    pfs: c.title.pfs,
    legacy: c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    action_cost: c.title.action_cost,
    traits: c.traits.traits,
    trait_ids: c.traits.trait_ids,
    source: { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources: c.sources,
    archetypes,
    archetype_footnotes,
    prerequisites: dashToNull(getField(c, 'Prerequisites', 'Prerequisite')),
    frequency:     dashToNull(getField(c, 'Frequency')),
    trigger:       dashToNull(getField(c, 'Trigger')),
    requirements:  dashToNull(getField(c, 'Requirements')),
    cost:          dashToNull(getField(c, 'Cost')),
    access:        dashToNull(getField(c, 'Access')),
    is_mythic,
    description_html: description.html,
    description_text: description.text,
    special,
    leads_to,
    related_feats,
    trait_glossary,
    raw_fields: { ...c.field_map },
    links: bodyLinks.length > 0 ? bodyLinks : c.links,
    meta_description: extractMetaDescription($),
    meta_keywords: extractMetaKeywords($),
  };
}
