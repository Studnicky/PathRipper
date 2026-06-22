// Feat extractor for AON (Archives of Nethys, 2e.aonprd.com).
// Consumes the shared CommonExtraction and projects a strongly typed Feat
// shape, including archetype links, the "Leads To" subsection, and the
// in-page Traits glossary block.
import type { CheerioAPI } from 'cheerio';
import {
  type CommonExtraction, type CheerioNode, type ActionCost, type LinkRef,
  type Rarity, type PfsLegality,
  getField, getFieldHtml, htmlToText, harvestLinks,
} from './common.js';

// ─── Output shape ─────────────────────────────────────────────────────────────

export interface FeatOutput {
  _type: 'feat';
  url: string;
  name: string;
  level: number | null;
  rarity: Rarity;
  pfs: PfsLegality | null;
  legacy: boolean;
  alt_edition_url: string | null;
  action_cost: ActionCost | null;
  traits: string[];
  source: { book: string | null; page: number | null; source_id: number | null };
  archetypes: Array<{ name: string; archetype_id: number | null }>;
  archetype_footnotes: string[];
  prerequisites: string | null;
  frequency: string | null;
  trigger: string | null;
  requirements: string | null;
  cost: string | null;
  access: string | null;
  description_html: string;
  description_text: string;
  special: string | null;
  leads_to: Array<{ name: string; feat_id: number | null }>;
  trait_glossary: Array<{ trait: string; description: string }>;
  raw_fields: Record<string, string>;
  links: LinkRef[];
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
  const archetype_footnotes = parseArchetypeFootnotes(readHeadHtml(span));

  const description = buildDescription(c.body_html);
  const special = extractSpecial(c.body_html);
  const leads_to = parseLeadsTo(c);
  const trait_glossary = parseTraitGlossary($, span);

  const bodyLinks = harvestLinks(c.body_html);

  return {
    _type: 'feat',
    url: c.url,
    name: c.title.name,
    level: c.title.level,
    rarity: c.traits.rarity,
    pfs: c.title.pfs,
    legacy: c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    action_cost: c.title.action_cost,
    traits: c.traits.traits,
    source: { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    archetypes,
    archetype_footnotes,
    prerequisites: dashToNull(getField(c, 'Prerequisites', 'Prerequisite')),
    frequency:     dashToNull(getField(c, 'Frequency')),
    trigger:       dashToNull(getField(c, 'Trigger')),
    requirements:  dashToNull(getField(c, 'Requirements')),
    cost:          dashToNull(getField(c, 'Cost')),
    access:        dashToNull(getField(c, 'Access')),
    description_html: description.html,
    description_text: description.text,
    special,
    leads_to,
    trait_glossary,
    raw_fields: { ...c.field_map },
    links: bodyLinks.length > 0 ? bodyLinks : c.links,
  };
}
