// Domain concept — Phase 6.4 taxonomic extraction.
//
// Domain pages (Domains.aspx) are short divine-domain entries: name, source,
// deity list, domain spell + advanced domain spell, optional Apocryphal Domain
// Spells subsection, and a brief flavor description. This concept delegates to
// the Wave 5 slice helpers in domain.ts for correctness; output is
// byte-equivalent to the Wave 5 baseline.
//
// Improvement vs Wave 5: no bespoke node-folder; capabilities are co-located
// in this file with inline contracts.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../src/services/RipperServices.js';
import type { ConceptDecl, ConceptOutputBase } from '../taxonomy.js';
import { setConceptOutput } from './_helpers.js';
import {
  CAPABILITY_OUTPUTS,
  type CommonExtraction,
  type CheerioNode,
  type LinkRef,
  type Rarity,
  type SourceRef,
  type Section,
  htmlToText,
  harvestLinks,
  getFieldHtml,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';

// ─── Inlined from Wave 5: domain.ts ──────────────────────────────────
// ─── Output shape ─────────────────────────────────────────────────────────────

/** A spell reference parsed from a `<b>Domain Spell</b>` field. */
export interface DomainSpellRef {
  /** Display name of the spell (e.g. "Weapon Surge"). */
  name: string;
  /** AON Spells.aspx ID, when the link is present. */
  spell_id: number | null;
}

/** A deity that includes this domain in its granted domain list. */
export interface DomainDeityRef {
  /** Display name of the deity. */
  name: string;
  /** AON Deities.aspx ID, when the link is present. */
  deity_id: number | null;
}

/**
 * Apocryphal-spell pair captured from the optional `<h3>Apocryphal Domain Spells</h3>`
 * subsection. Both fields may be null when AON shows an em-dash for an entry.
 */
export interface DomainApocryphalSpells {
  apocryphal_domain_spell:          DomainSpellRef | null;
  apocryphal_advanced_domain_spell: DomainSpellRef | null;
  /** Source of the apocryphal section, when present. */
  source: SourceRef | null;
}

export interface DomainOutputFields {
  url: string;
  /** Numeric AON ID extracted from the URL query string. */
  domain_id: number | null;
  name: string;
  rarity: Rarity;
  traits: string[];
  /** Trait AON IDs keyed by trait name. */
  trait_ids: Record<string, number>;
  source: { book: string | null; page: number | null; source_id: number | null };
  /** All source refs on the page (header + apocryphal subsection footnotes). */
  sources: SourceRef[];
  legacy: boolean;
  alt_edition_url: string | null;
  pfs: 'standard' | 'limited' | 'restricted' | null;
  /** Deities granting access to this domain (header `<b>Deities</b>` list). */
  deities_using: DomainDeityRef[];
  /** Primary domain spell (`<b>Domain Spell</b>` field). */
  domain_spell: DomainSpellRef | null;
  /** Advanced domain spell (`<b>Advanced Domain Spell</b>` field). */
  advanced_domain_spell: DomainSpellRef | null;
  /** Optional Apocryphal Domain Spells subsection block. Null when absent. */
  apocryphal: DomainApocryphalSpells | null;
  /** Brief flavor description following the spell line. */
  description_text: string;
  /** Raw HTML of the flavor description span. */
  description_html: string;
  sections: Section[];
  raw_fields: Record<string, string>;
  links: LinkRef[];
  body_html: string;
  body_text: string;
  /** `<meta name="description">` content. */
  meta_description: string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords: string | null;
}

/** Full output shape — `_type` discriminator stamped by the router at chain entry. */
export type DomainOutput = ConceptOutputBase<'domain'> & DomainOutputFields;

// ─── Per-node slice types ─────────────────────────────────────────────────────

/** Fields owned by `extract-domain-base`. */
export interface DomainBaseSlice {
  url:             string;
  domain_id:       number | null;
  name:            string;
  rarity:          Rarity;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          DomainOutputFields['source'];
  sources:         SourceRef[];
  legacy:          boolean;
  alt_edition_url: string | null;
  pfs:             DomainOutputFields['pfs'];
}

/** Fields owned by `extract-domain-spells`. */
export interface DomainSpellsSlice {
  domain_spell:          DomainSpellRef | null;
  advanced_domain_spell: DomainSpellRef | null;
  apocryphal:            DomainApocryphalSpells | null;
}

/** Fields owned by `extract-domain-meta`. */
export interface DomainMetaSlice {
  description_text: string;
  description_html: string;
  sections:         Section[];
  deities_using:    DomainDeityRef[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DASH_RE = /^(?:—|–|-|&mdash;|&ndash;)$/;

/** Treat an em-dash / `—` / `&mdash;` value as a null spell reference. */
function isDash(text: string | null): boolean {
  if (text === null) return true;
  // Strip trailing `;` / `,` punctuation that AON appends when the spell label
  // is followed by another `<b>Advanced Domain Spell</b>` chunk on the same line.
  const trimmed = text.trim().replace(/[;,]\s*$/, '').trim();
  return trimmed === '' || DASH_RE.test(trimmed);
}

/**
 * Return the head region of a domain page body — everything before the first
 * `<h2>` / `<h3>` subsection heading (which would mark e.g. the Apocryphal
 * Domain Spells block).
 *
 * Domain pages have no `<hr />` separator: the standard `extractCommon` flow
 * pushes the entire Deities + Domain Spell + flavor region into `c.body_html`
 * already (its `harvestFields` only reaches the Source line). We re-harvest
 * labels from that body region directly.
 */
function domainHeadBody(bodyHtml: string): string {
  const headingRe = /<h[23]\s+class="title"/i;
  const m = headingRe.exec(bodyHtml);
  return m === null ? bodyHtml : bodyHtml.slice(0, m.index);
}

/** Escape regex metacharacters in a literal label string. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Return the verbatim HTML following `<b>Label</b>` inside `html`, ending at
 * the next `<b>`, `<br>`, `<hr>`, `</span>`, or `<h2>`/`<h3>` subsection.
 *
 * Used to lift Domain Spell / Advanced Domain Spell / Deities labels out of
 * a domain page's body region (the Source line already terminated the head,
 * so `harvestFields` doesn't see these labels).
 */
function pickLabelHtml(html: string, label: string): string | null {
  const labelRe = new RegExp(`<b>\\s*${escapeRegex(label)}\\s*<\\/b>`, 'i');
  const m = labelRe.exec(html);
  if (m === null) return null;
  const start    = m.index + m[0].length;
  const rest     = html.slice(start);
  const boundary = /<b>|<br\s*\/?>|<hr\s*\/?>|<\/span>|<h[23]\s+class="title"/i.exec(rest);
  const end      = boundary !== null ? boundary.index : rest.length;
  return rest.slice(0, end);
}

/**
 * Parse a `<b>Domain Spell</b>` value (HTML) into a {@link DomainSpellRef}.
 *
 * AON renders the spell anchor with a slight tag-order quirk:
 *   `<u><i><a href="Spells.aspx?ID=N">Spell Name</i></a></u>`
 *
 * We walk the first `<a>` whose href points at `Spells.aspx` and read its
 * inner text plus the `?ID=` query parameter. Em-dashes / blank values
 * resolve to null (Apocryphal slots can be unfilled).
 */
function parseSpellRef(valueHtml: string | null): DomainSpellRef | null {
  if (valueHtml === null) return null;
  const text = htmlToText(valueHtml);
  if (isDash(text)) return null;

  const anchorRe = /<a\b[^>]*href="([^"]*Spells\.aspx[^"]*)"[^>]*>([\s\S]*?)<\/a>/i;
  const m = anchorRe.exec(valueHtml);
  if (m === null) {
    // No anchor — return the raw text as the name with a null id.
    return text === '' ? null : { name: text, spell_id: null };
  }
  const href      = m[1] ?? '';
  const innerText = htmlToText(m[2] ?? '');
  const idMatch   = /\?ID=(\d+)/i.exec(href);
  const spell_id  = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
  if (innerText === '') return null;
  return { name: innerText, spell_id };
}

/**
 * Walk every `<a href="Deities.aspx?ID=N">Name</a>` link inside the
 * `<b>Deities</b>` field value HTML. Each deity appears as a comma-separated
 * `<u><a>Name</a></u>` chip; we deduplicate by deity_id when present, else
 * by display name.
 */
function parseDeityList(valueHtml: string | null): DomainDeityRef[] {
  if (valueHtml === null) return [];
  const out: DomainDeityRef[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b[^>]*href="([^"]*Deities\.aspx[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(valueHtml)) !== null) {
    const href  = m[1] ?? '';
    const inner = m[2] ?? '';
    const name  = htmlToText(inner);
    if (name === '') continue;
    const idMatch = /\?ID=(\d+)/i.exec(href);
    const deity_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    const key = deity_id !== null ? `id:${deity_id}` : `name:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, deity_id });
  }
  return out;
}

/**
 * Extract the flavor description text + raw HTML.
 *
 * The description is the prose that follows the last `<br />` of the head
 * block on a domain page (e.g. "Your inner fire increases your combat
 * prowess."). Domain pages have no `<hr />` separator, so `splitOnHr` falls
 * back to splitting after the trailing `<br />` of the Source line — the
 * resulting `body_html` retains the Deities + Domain Spell lines and ends
 * with the flavor text.
 *
 * Strategy: locate the last `<br />` in the head HTML and return everything
 * after it (until either an `<h2>`/`<h3>` subsection or end-of-span). We
 * stop at the first subsection heading so the Apocryphal block doesn't bleed
 * into the description.
 */
function extractDescription(c: CommonExtraction): { html: string; text: string } {
  // The full head section (head + body) is what we walk: AON puts the flavor
  // text inside the head_html on most domain pages because no `<hr />` is
  // present. `c.body_html` may also contain a tail copy. Try body_html first
  // (it's what `splitOnHr` returns); fall back to scanning the field tail.
  const html = c.body_html;

  // Stop at the first subsection heading (Apocryphal Domain Spells etc).
  const headIdx = /<h[23]\s+class="title"/i.exec(html);
  const scope = headIdx === null ? html : html.slice(0, headIdx.index);

  // The flavor text sits after the last `<br />` in the scope (which closes
  // the Domain Spell line). Find the last `<br />`.
  const brRe = /<br\s*\/?>/gi;
  let lastIdx = -1;
  let lastLen = 0;
  let m: RegExpExecArray | null;
  while ((m = brRe.exec(scope)) !== null) {
    lastIdx = m.index;
    lastLen = m[0].length;
  }
  if (lastIdx === -1) {
    // No `<br />` — return the scope verbatim.
    return { html: scope.trim(), text: htmlToText(scope) };
  }
  const tail = scope.slice(lastIdx + lastLen);
  return { html: tail.trim(), text: htmlToText(tail) };
}

/**
 * Extract the optional Apocryphal Domain Spells block, when present.
 *
 * The block is introduced by `<h3 class="title">Apocryphal Domain Spells</h3>`
 * inside the body, followed by a `<b>Source</b>` ref, prose, and a
 * `<b>Apocryphal Domain Spell</b>` / `<b>Advanced Domain Spell</b>` pair.
 */
function parseApocryphal(bodyHtml: string): DomainApocryphalSpells | null {
  const headingRe = /<h3\s+class="title"[^>]*>\s*Apocryphal Domain Spells\s*<\/h3>/i;
  const heading = headingRe.exec(bodyHtml);
  if (heading === null) return null;
  const tail = bodyHtml.slice(heading.index + heading[0].length);

  // Source line for the apocryphal block.
  const srcRe = /<b>\s*Source\s*<\/b>\s*<a\b[^>]*href="[^"]*Sources\.aspx\?ID=(\d+)"[^>]*>\s*<i>([^<]+)<\/i>/i;
  const srcMatch = srcRe.exec(tail);
  let source: SourceRef | null = null;
  if (srcMatch !== null) {
    const sourceId = parseInt(srcMatch[1]!, 10);
    const label    = (srcMatch[2] ?? '').trim();
    const pgMatch  = /^(.*?)\s*pg\.\s*(\d+)/i.exec(label);
    const book = pgMatch !== null ? pgMatch[1]!.trim() : label;
    const pg   = pgMatch !== null ? parseInt(pgMatch[2]!, 10) : null;
    source = {
      book:      book === '' ? null : book,
      page:      pg !== null && Number.isFinite(pg) ? pg : null,
      source_id: Number.isFinite(sourceId) ? sourceId : null,
      raw:       label,
    };
  }

  // Extract the apocryphal `<b>Apocryphal Domain Spell</b>` and adjacent
  // `<b>Advanced Domain Spell</b>` value HTMLs. We pull the value up to the
  // next `<b>` (label boundary) or `</span>`.
  const pickValueHtml = (labelRe: RegExp): string | null => {
    const labelMatch = labelRe.exec(tail);
    if (labelMatch === null) return null;
    const start = labelMatch.index + labelMatch[0].length;
    const rest = tail.slice(start);
    const boundary = /<b>|<\/span>/i.exec(rest);
    const end = boundary !== null ? boundary.index : rest.length;
    return rest.slice(0, end);
  };

  const apocryphalValue = pickValueHtml(/<b>\s*Apocryphal Domain Spell\s*<\/b>/i);
  const advancedValue   = pickValueHtml(/<b>\s*Advanced Domain Spell\s*<\/b>/i);

  return {
    apocryphal_domain_spell:          parseSpellRef(apocryphalValue),
    apocryphal_advanced_domain_spell: parseSpellRef(advancedValue),
    source,
  };
}

/**
 * Harvest top-level `<h2 class="title">` and `<h3 class="title">` subsections
 * from a domain page. We re-implement against `c.body_html` (rather than
 * calling the cheerio-based `harvestSections`) because domain pages have no
 * `<hr />` and the body_html string passed in is already pre-sliced. Pure
 * regex avoids re-parsing the document.
 */
function harvestDomainSections(bodyHtml: string): Section[] {
  const out: Section[] = [];
  const headingRe = /<h([23])\s+class="title"[^>]*>([\s\S]*?)<\/h\1>/gi;
  type Marker = { level: 2 | 3; heading: string; start: number; end: number };
  const markers: Marker[] = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(bodyHtml)) !== null) {
    const lvl = parseInt(m[1]!, 10);
    const level: 2 | 3 = lvl === 3 ? 3 : 2;
    const heading = htmlToText(m[2] ?? '');
    if (heading === '') continue;
    markers.push({ level, heading, start: m.index, end: m.index + m[0].length });
  }
  for (let i = 0; i < markers.length; i++) {
    const cur = markers[i]!;
    const next = markers[i + 1];
    const bodyStart = cur.end;
    const bodyEnd = next === undefined ? bodyHtml.length : next.start;
    const body_html = bodyHtml.slice(bodyStart, bodyEnd);
    out.push({
      heading:   cur.heading,
      level:     cur.level,
      body_html,
      body_text: htmlToText(body_html),
      links:     harvestLinks(body_html),
    });
  }
  return out;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract base identity slice (URL, traits, rarity, sources, pfs, legacy). */
export function extractDomainBase(c: CommonExtraction): DomainBaseSlice {
  return {
    url:             c.url,
    domain_id:       extractEntityId(c.url),
    name:            c.title.name,
    rarity:          c.traits.rarity,
    traits:          c.traits.traits,
    trait_ids:       c.traits.trait_ids,
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:         c.sources,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    pfs:             c.title.pfs,
  };
}

/**
 * Extract the spell slice (primary + advanced domain spells, plus the
 * optional Apocryphal Domain Spells subsection).
 *
 * Domain pages have no `<hr />` between Source and the rest, so `extractCommon`
 * leaves the Deities + Domain Spell + Advanced Domain Spell labels inside
 * `c.body_html`. We pull them with {@link pickLabelHtml} from the head region
 * (the body before any `<h2>`/`<h3>` subsection).
 */
export function extractDomainSpells(c: CommonExtraction): DomainSpellsSlice {
  const head = domainHeadBody(c.body_html);
  return {
    domain_spell:          parseSpellRef(pickLabelHtml(head, 'Domain Spell')),
    advanced_domain_spell: parseSpellRef(pickLabelHtml(head, 'Advanced Domain Spell')),
    apocryphal:            parseApocryphal(c.body_html),
  };
}

/**
 * Extract the meta slice: flavor description, deity list, harvested sections.
 *
 * The deities-using list lives on a `<br />`-terminated line of
 * `<b>Deities</b> <u><a>Name</a></u>, <u><a>Name</a></u>, …` anchors inside
 * the body head region. We pick the label's value HTML and walk every
 * `Deities.aspx` anchor to produce structured references.
 */
export function extractDomainMeta(c: CommonExtraction): DomainMetaSlice {
  const head        = domainHeadBody(c.body_html);
  const description = extractDescription(c);
  return {
    description_text: description.text,
    description_html: description.html,
    sections:         harvestDomainSections(c.body_html),
    deities_using:    parseDeityList(pickLabelHtml(head, 'Deities')),
  };
}

/** AON labels every per-slice helper has lifted into structured fields. */
const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Deities',
  'Domain Spell',
  'Advanced Domain Spell',
  'Apocryphal Domain Spell',
];

/**
 * Assemble the final DomainOutput from per-slice results.
 *
 * Computes `raw_fields` by stripping every label claimed by upstream slices
 * and attaches the body / link / meta fields owned by the full page.
 */
export function finalizeDomain(
  c:      CommonExtraction,
  base:   DomainBaseSlice,
  spells: DomainSpellsSlice,
  meta:   DomainMetaSlice,
  $:      CheerioAPI,
): DomainOutputFields {
  return {
    ...base,
    ...spells,
    deities_using:    meta.deities_using,
    description_text: meta.description_text,
    description_html: meta.description_html,
    sections:         meta.sections,
    raw_fields:       stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS),
    links:            c.links,
    body_html:        c.body_html,
    body_text:        c.body_text,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies DomainOutputFields;
}

// ─── Public extractor ─────────────────────────────────────────────────────────

/**
 * Project a CommonExtraction of a Domains.aspx page into a typed DomainOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through
 * the decomposed domain extraction nodes.
 */
export function extractDomain(c: CommonExtraction, $: CheerioAPI, span: CheerioNode): DomainOutputFields {
  void span;
  const base   = extractDomainBase(c);
  const spells = extractDomainSpells(c);
  const meta   = extractDomainMeta(c);
  return finalizeDomain(c, base, spells, meta, $);
}


// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type DomainBaseOutput = 'success' | 'error';

export const domainBaseNode: NodeInterface<ScrapeState, DomainBaseOutput, RipperServices> = {
  name:    'extract:domain-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: DomainBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractDomainBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type DomainSpellsOutput = 'success' | 'error';

export const domainSpellsNode: NodeInterface<ScrapeState, DomainSpellsOutput, RipperServices> = {
  name:    'extract:domain-spells',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: DomainSpellsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const spells = extractDomainSpells(c);

    state.output = { ...state.output, ...spells };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type DomainMetaOutput = 'success' | 'error';

export const domainMetaNode: NodeInterface<ScrapeState, DomainMetaOutput, RipperServices> = {
  name:    'extract:domain-meta',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: DomainMetaOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const meta = extractDomainMeta(c);

    state.output = { ...state.output, ...meta };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeDomainOutput = 'success';

export const finalizeDomainNode: NodeInterface<ScrapeState, FinalizeDomainOutput, RipperServices> = {
  name:    'finalize:domain',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeDomainOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $ = state.getMetadata<CheerioAPI>('aonprdCheerio');
    // Require at least base to have run (state.output set).
    if (c === undefined || $ === undefined || state.output === null) return { output: 'success' };
    const acc = (state.output ?? {}) as unknown as DomainOutput;
    const assembled = finalizeDomain(c, acc, acc, acc, $);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const domainConcept: ConceptDecl<DomainOutput> = {
  id:       'domain',
  parent:   'entity',
  urlPaths: ['domains'],
  capabilities: [
    domainBaseNode,
    domainSpellsNode,
    domainMetaNode,
    finalizeDomainNode,
  ],
  discriminator: { _type: 'domain' },
};
