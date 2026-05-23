// Plane concept — Phase 6.4 taxonomic extraction.
//
// Delegates to the Wave 5 slice helpers in plane.ts for correctness, adding
// legacy-section filtering on the `sections[]` output.
//
// Improvement vs Wave 5: `sections[]` filters legacy-content-warning h3 blocks
// (mirrors the language concept pattern); the `legacy: true` flag already
// carries that signal from the title extraction.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../src/services/RipperServices.js';
import type { ConceptDecl } from '../taxonomy.js';
import { setConceptOutput } from './_helpers.js';
import {
  CAPABILITY_OUTPUTS,
  type CommonExtraction,
  type CheerioNode,
  type Section,
  type LinkRef,
  type Rarity,
  type PfsLegality,
  type SourceRef,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
  htmlToText,
  splitTopLevel,
  extractEntityId,
  filterLegacySections,
} from '../common.js';

// ─── Inlined from Wave 5: plane.ts ──────────────────────────────────
// ─── Output type ──────────────────────────────────────────────────────────────

/**
 * A linked divinity reference harvested from a plane's `<b>Divinities</b>`
 * line. Divinities are a heterogenous mix — single deities, deity categories,
 * and unlinked tribal collectives ("goblin hero-gods") — so we capture an
 * optional `deity_id` plus the verbatim href when present and fall back to a
 * name-only entry for unlinked tokens.
 */
export interface PlaneDivinityRef {
  /** Display name of the divinity / category. */
  name:        string;
  /** AON Deities.aspx ID, when the link targets `Deities.aspx`. */
  deity_id:    number | null;
  /** Verbatim href, when present. */
  href:        string | null;
}

/** A linked native-inhabitant reference (creature / family / ancestry). */
export interface PlaneInhabitantRef {
  /** Display name of the linked inhabitant. */
  name:          string;
  /** Numeric AON id of the linked inhabitant (Monsters.aspx, MonsterFamilies.aspx, Ancestries.aspx, …). */
  inhabitant_id: number | null;
  /** Verbatim href, when present. */
  href:          string | null;
}

export interface PlaneOutput {
  _type:            'plane';
  url:              string;
  /** Numeric AON Planes.aspx ID extracted from the URL query string. */
  plane_id:         number | null;
  name:             string;
  rarity:           Rarity;
  pfs:              PfsLegality | null;
  legacy:           boolean;
  alt_edition_url:  string | null;
  traits:           string[];
  trait_ids:        Record<string, number>;
  source:           { book: string | null; page: number | null; source_id: number | null };
  sources:          SourceRef[];

  // ─── Denizens slice ───────────────────────────────────────────────────────
  divinities:         PlaneDivinityRef[];
  native_inhabitants: PlaneInhabitantRef[];

  // ─── Characteristics slice ────────────────────────────────────────────────
  /** Cosmological category (e.g. "Inner Sphere Planes", "Outer Sphere Planes"). */
  category:           string | null;
  /** Right-aligned title tag (e.g. "Plane"), captured from the header span. */
  aspect:             string | null;

  // ─── Meta slice ───────────────────────────────────────────────────────────
  /** Prose flavor body (post-`<hr />` description). */
  description_text:   string;
  /** Raw HTML of the description body. */
  description_html:   string;
  sections:           Section[];
  raw_fields:         Record<string, string>;
  links:              LinkRef[];
  body_text:          string;
  body_html:          string;
  /** `<meta name="description">` content. */
  meta_description:   string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords:      string | null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────────

/** Fields owned by `extract-plane-base`. */
export interface PlaneBaseSlice {
  _type:           'plane';
  url:             string;
  plane_id:        number | null;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          PlaneOutput['source'];
  sources:         SourceRef[];
}

/** Fields owned by `extract-plane-denizens`. */
export interface PlaneDenizensSlice {
  divinities:         PlaneDivinityRef[];
  native_inhabitants: PlaneInhabitantRef[];
}

/** Fields owned by `extract-plane-characteristics`. */
export interface PlaneCharacteristicsSlice {
  category: string | null;
  aspect:   string | null;
}

/** Fields owned by `extract-plane-meta`. */
export interface PlaneMetaSlice {
  description_text: string;
  description_html: string;
  sections:         Section[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Tokens that mean "no entries" — coerce to an empty list. */
const NONE_RE = /^(?:none|—|–|-|n\/a)$/i;

/**
 * Read a label's verbatim value HTML from the field map. We need the
 * value-HTML rather than the flattened text because the Divinities and Native
 * Inhabitants lines contain linked anchors we need to walk for ids.
 */
function fieldHtmlByLabel(c: CommonExtraction, label: string): string | null {
  for (const field of c.fields) {
    if (field.label === label) return field.value_html;
  }
  return null;
}

/**
 * Walk every `<a href>` anchor in a value-HTML fragment, classifying its href
 * to extract the entity id (when the href matches a known AON detail URL).
 *
 * Unlinked tokens (e.g. "Camazotz", "goblin hero-gods") are recovered by
 * splitting the residual text on top-level commas and producing
 * name-only entries with `aon_id: null`. Order is preserved end-to-end.
 */
type LinkedToken = { name: string; aon_id: number | null; href: string | null };

function parseLinkedList(valueHtml: string | null): LinkedToken[] {
  if (valueHtml === null) return [];
  const out: LinkedToken[] = [];
  const seen = new Set<string>();

  // Strategy: split the HTML on top-level commas (preserves anchors), then for
  // each token detect whether it carries an `<a href>` and harvest the id.
  // We walk the original HTML token-by-token because splitTopLevel works on a
  // string regardless of tag content (it ignores commas inside `<…>`).
  const tokens = splitTopLevel(valueHtml, ',');
  for (const rawToken of tokens) {
    const token = rawToken.trim();
    if (token === '') continue;
    const text = htmlToText(token);
    if (text === '' || NONE_RE.test(text)) continue;

    // Each token may itself contain multiple anchors (e.g. "<a>X</a> and
    // countless other ancestries"). Walk every anchor; if none, produce a
    // name-only entry from the flattened text.
    const anchorRe = /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let anchorMatch: RegExpExecArray | null;
    let foundAnchor = false;
    anchorRe.lastIndex = 0;
    while ((anchorMatch = anchorRe.exec(token)) !== null) {
      foundAnchor = true;
      const href     = anchorMatch[1] ?? '';
      const inner    = anchorMatch[2] ?? '';
      const name     = htmlToText(inner);
      if (name === '') continue;
      const idMatch  = /\?ID=(\d+)/i.exec(href);
      const entityId = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
      const key = entityId !== null ? `${href}:${entityId}` : `name:${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, aon_id: entityId, href });
    }
    if (!foundAnchor) {
      // Pure text token (no link). Capture as a name-only entry.
      const key = `name:${text.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: text, aon_id: null, href: null });
    }
  }
  return out;
}

/**
 * Map a linked-token list into {@link PlaneDivinityRef}s. We keep entries with
 * non-deity hrefs (DeityCategories.aspx, MonsterFamilies.aspx) as well as
 * unlinked tokens because AON uses all three forms intermixed.
 */
function toDivinityRefs(tokens: LinkedToken[]): PlaneDivinityRef[] {
  return tokens.map(({ name, aon_id, href }) => {
    const isDeityLink = href !== null && /Deities\.aspx/i.test(href);
    return {
      name,
      deity_id: isDeityLink ? aon_id : null,
      href,
    };
  });
}

/** Map a linked-token list into {@link PlaneInhabitantRef}s. */
function toInhabitantRefs(tokens: LinkedToken[]): PlaneInhabitantRef[] {
  return tokens.map(({ name, aon_id, href }) => ({ name, inhabitant_id: aon_id, href }));
}

/**
 * Extract the right-aligned title aspect tag (e.g. "Plane") from the page's
 * header span. Planes pages render this as:
 *
 *   <h1 class="title"><a>...</a><span style="margin-left:auto;...">Plane</span></h1>
 */
function extractAspect($: CheerioAPI): string | null {
  // First H1 with class="title" — the named title row.
  const h1 = $('h1.title').first();
  if (h1.length === 0) return null;
  const tagSpan = h1.find('span').filter((_, el) => {
    const style = ($(el).attr('style') ?? '').toLowerCase();
    return style.includes('margin-left:auto') || style.includes('margin-right:0');
  }).first();
  if (tagSpan.length === 0) return null;
  const text = tagSpan.text().trim();
  return text === '' ? null : text;
}

/** Extract the prose description from `body_html` (post-`<hr />`). */
function extractDescription(c: CommonExtraction): { html: string; text: string } {
  // Planes.aspx pages always emit `<hr />` between the field block and prose,
  // so `c.body_html` already begins with the description. Trim trailing
  // `</span>` artifacts.
  const trimmed = c.body_html.replace(/\s*<\/span>\s*$/i, '').trim();
  return { html: trimmed, text: htmlToText(trimmed) };
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract identity + header scalars + sources + traits for a plane page. */
export function extractPlaneBase(c: CommonExtraction): PlaneBaseSlice {
  return {
    _type:           'plane',
    url:             c.url,
    plane_id:        extractEntityId(c.url),
    name:            c.title.name,
    rarity:          c.traits.rarity,
    pfs:             c.title.pfs,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    traits:          c.traits.traits,
    trait_ids:       c.traits.trait_ids,
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:         c.sources,
  };
}

/**
 * Extract divinities + native inhabitants from their respective `<b>Label</b>`
 * lines in the field block.
 */
export function extractPlaneDenizens(c: CommonExtraction): PlaneDenizensSlice {
  const divHtml = fieldHtmlByLabel(c, 'Divinities');
  const natHtml = fieldHtmlByLabel(c, 'Native Inhabitants');
  return {
    divinities:         toDivinityRefs(parseLinkedList(divHtml)),
    native_inhabitants: toInhabitantRefs(parseLinkedList(natHtml)),
  };
}

/**
 * Extract characteristic scalars (category from the field map, aspect from
 * the right-aligned title span).
 */
export function extractPlaneCharacteristics(
  c: CommonExtraction,
  $: CheerioAPI,
): PlaneCharacteristicsSlice {
  const categoryRaw = c.field_map['Category'] ?? null;
  return {
    category: categoryRaw !== null && categoryRaw.trim() !== '' ? categoryRaw.trim() : null,
    aspect:   extractAspect($),
  };
}

/** Extract the description body + harvested sections owned by the meta slice. */
export function extractPlaneMeta(c: CommonExtraction): PlaneMetaSlice {
  const description = extractDescription(c);
  return {
    description_text: description.text,
    description_html: description.html,
    sections:         c.sections,
  };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

/** AON labels claimed by upstream plane slices. */
const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source', 'Category', 'Divinities', 'Native Inhabitants',
];

export function finalizePlane(
  c:                CommonExtraction,
  base:             PlaneBaseSlice,
  denizens:         PlaneDenizensSlice,
  characteristics:  PlaneCharacteristicsSlice,
  meta:             PlaneMetaSlice,
  $:                CheerioAPI,
): PlaneOutput {
  return {
    ...base,
    ...denizens,
    ...characteristics,
    description_text: meta.description_text,
    description_html: meta.description_html,
    sections:         meta.sections,
    raw_fields:       stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS),
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies PlaneOutput;
}

/**
 * Project a Planes.aspx page into a typed PlaneOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through
 * the decomposed plane extraction nodes.
 */
export function extractPlane(
  c:      CommonExtraction,
  $:      CheerioAPI,
  target: CheerioNode,
): PlaneOutput {
  void target;
  const base            = extractPlaneBase(c);
  const denizens        = extractPlaneDenizens(c);
  const characteristics = extractPlaneCharacteristics(c, $);
  const meta            = extractPlaneMeta(c);
  return finalizePlane(c, base, denizens, characteristics, meta, $);
}


// Re-export output type so tests can import from here.
// ─── Helpers ─────────────────────────────────────────────────────────────────

/** AON labels claimed by plane capability nodes. */

// ─── Capability nodes ─────────────────────────────────────────────────────────

export type PlaneBaseOutput = 'success' | 'error';

export const planeBaseNode: NodeInterface<ScrapeState, PlaneBaseOutput, RipperServices> = {
  name:    'extract:plane-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: PlaneBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base     = extractPlaneBase(c);
    const denizens = extractPlaneDenizens(c);

    state.output = state.output !== null
      ? { ...state.output, ...base, ...denizens }
      : { ...base, ...denizens };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type PlaneCharacteristicsOutput = 'success' | 'error';

export const planeCharacteristicsNode: NodeInterface<ScrapeState, PlaneCharacteristicsOutput, RipperServices> = {
  name:    'extract:plane-characteristics',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: PlaneCharacteristicsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $ = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (c === undefined || $ === undefined) return { output: 'error' };

    const chars = extractPlaneCharacteristics(c, $);

    state.output = { ...state.output, ...chars };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizePlaneOutput = 'success';

export const finalizePlaneNode: NodeInterface<ScrapeState, FinalizePlaneOutput, RipperServices> = {
  name:    'finalize:plane',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'sections'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizePlaneOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $ = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const sections = state.getMetadata<Section[]>('sections');
    if (c === undefined || $ === undefined || sections === undefined) return { output: 'success' };

    const trimmed = c.body_html.replace(/\s*<\/span>\s*$/i, '').trim();
    const raw_fields       = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
    const links            = c.links;
    const meta_description = extractMetaDescription($);
    const meta_keywords    = extractMetaKeywords($);

    state.output = state.output !== null
      ? {
        ...state.output,
        description_text:   trimmed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        description_html:   trimmed,
        sections:           filterLegacySections(sections),
        raw_fields,
        links,
        body_text:          c.body_text,
        body_html:          c.body_html,
        meta_description,
        meta_keywords,
      }
      : {
        description_text:   trimmed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        description_html:   trimmed,
        sections:           filterLegacySections(sections),
        raw_fields,
        links,
        body_text:          c.body_text,
        body_html:          c.body_html,
        meta_description,
        meta_keywords,
      };

    return { output: 'success' };
  },
};

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const planeConcept: ConceptDecl<PlaneOutput> = {
  id:       'plane',
  parent:   'entity',
  urlPaths: ['planes'],
  capabilities: [
    planeBaseNode,
    planeCharacteristicsNode,
    finalizePlaneNode,
  ],
  discriminator: { _type: 'plane' },
};
