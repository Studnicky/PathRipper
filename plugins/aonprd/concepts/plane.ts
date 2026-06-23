//
// Adds legacy-section filtering on the `sections[]` output.
//
// (mirrors the language concept pattern); the `legacy: true` flag already
// carries that signal from the title extraction.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { ConceptDecl } from '../../../src/taxonomy/Taxonomy.js';
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

// ─── Output type ─────────────────────────────────────────────────────────────

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
function fieldHtmlByLabel(common: CommonExtraction, label: string): string | null {
  for (const field of common.fields) {
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
function extractAspect(root: CheerioAPI): string | null {
  // First H1 with class="title" — the named title row.
  const h1El = root('h1.title').first();
  if (h1El.length === 0) return null;
  const tagSpan = h1El.find('span').filter((_index, element) => {
    const style = (root(element).attr('style') ?? '').toLowerCase();
    return style.includes('margin-left:auto') || style.includes('margin-right:0');
  }).first();
  if (tagSpan.length === 0) return null;
  const text = tagSpan.text().trim();
  return text === '' ? null : text;
}

/** Extract the prose description from `body_html` (post-`<hr />`). */
function extractDescription(common: CommonExtraction): { html: string; text: string } {
  // Planes.aspx pages always emit `<hr />` between the field block and prose,
  // so `common.body_html` already begins with the description. Trim trailing
  // `</span>` artifacts.
  const trimmed = common.body_html.replace(/\s*<\/span>\s*$/i, '').trim();
  return { html: trimmed, text: htmlToText(trimmed) };
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract identity + header scalars + sources + traits for a plane page. */
export function extractPlaneBase(common: CommonExtraction): PlaneBaseSlice {
  return {
    url:             common.url,
    plane_id:        extractEntityId(common.url),
    name:            common.title.name,
    rarity:          common.traits.rarity,
    pfs:             common.title.pfs,
    legacy:          common.title.legacy,
    alt_edition_url: common.title.alt_edition_url,
    traits:          common.traits.traits,
    trait_ids:       common.traits.trait_ids,
    source:          { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:         common.sources,
  };
}

/**
 * Extract divinities + native inhabitants from their respective `<b>Label</b>`
 * lines in the field block.
 */
export function extractPlaneDenizens(common: CommonExtraction): PlaneDenizensSlice {
  const divHtml = fieldHtmlByLabel(common, 'Divinities');
  const natHtml = fieldHtmlByLabel(common, 'Native Inhabitants');
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
  common: CommonExtraction,
  root:   CheerioAPI,
): PlaneCharacteristicsSlice {
  const categoryRaw = common.field_map['Category'] ?? null;
  return {
    category: categoryRaw !== null && categoryRaw.trim() !== '' ? categoryRaw.trim() : null,
    aspect:   extractAspect(root),
  };
}

/** Extract the description body + harvested sections owned by the meta slice. */
export function extractPlaneMeta(common: CommonExtraction): PlaneMetaSlice {
  const description = extractDescription(common);
  return {
    description_text: description.text,
    description_html: description.html,
    sections:         common.sections,
  };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

/** AON labels claimed by upstream plane slices. */
const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source', 'Category', 'Divinities', 'Native Inhabitants',
];

export function finalizePlane(
  common:           CommonExtraction,
  base:             PlaneBaseSlice,
  denizens:         PlaneDenizensSlice,
  characteristics:  PlaneCharacteristicsSlice,
  meta:             PlaneMetaSlice,
  root:             CheerioAPI,
): PlaneOutput {
  return {
    ...base,
    ...denizens,
    ...characteristics,
    description_text: meta.description_text,
    description_html: meta.description_html,
    sections:         meta.sections,
    raw_fields:       stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS),
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
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
  common: CommonExtraction,
  root:   CheerioAPI,
  target: CheerioNode,
): PlaneOutput {
  void target;
  const base            = extractPlaneBase(common);
  const denizens        = extractPlaneDenizens(common);
  const characteristics = extractPlaneCharacteristics(common, root);
  const meta            = extractPlaneMeta(common);
  return finalizePlane(common, base, denizens, characteristics, meta, root);
}

// Re-export output type so tests can import from here.
// ─── Helpers ─────────────────────────────────────────────────────────────────

/** AON labels claimed by plane capability nodes. */

// ─── Capability nodes ─────────────────────────────────────────────────────────

export type PlaneBaseOutput = 'success' | 'error';

class PlaneBaseNodeImpl extends ScalarNode<ScrapeState, PlaneBaseOutput> {
  public readonly name = 'extract:plane-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<PlaneBaseOutput, SchemaObjectType> {
    return {
      // state.output merged with PlaneBaseSlice + PlaneDenizensSlice fields
      success: { type: 'object', properties: { output: { type: 'object' } }, required: ['output'] },
      error:   { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<PlaneBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base     = extractPlaneBase(common);
    const denizens = extractPlaneDenizens(common);

    state.output = state.output !== null
      ? { ...state.output, ...base, ...denizens }
      : { ...base, ...denizens };

    return NodeOutputBuilder.of('success');
  }
}
export const planeBaseNode = new PlaneBaseNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type PlaneCharacteristicsOutput = 'success' | 'error';

class PlaneCharacteristicsNodeImpl extends ScalarNode<ScrapeState, PlaneCharacteristicsOutput> {
  public readonly name = 'extract:plane-characteristics';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<PlaneCharacteristicsOutput, SchemaObjectType> {
    return {
      // state.output merged with PlaneCharacteristicsSlice (category: string|null, aspect: string|null)
      success: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          aspect:   { type: 'string' },
        },
      },
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<PlaneCharacteristicsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root   = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (common === undefined || root === undefined) return NodeOutputBuilder.of('error');

    const chars = extractPlaneCharacteristics(common, root);

    state.output = { ...state.output, ...chars };

    return NodeOutputBuilder.of('success');
  }
}
export const planeCharacteristicsNode = new PlaneCharacteristicsNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizePlaneOutput = 'success';

class FinalizePlaneNodeImpl extends ScalarNode<ScrapeState, FinalizePlaneOutput> {
  public readonly name = 'finalize:plane';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<FinalizePlaneOutput, SchemaObjectType> {
    return {
      // state.output gets description_text, description_html, sections, raw_fields, links, body_*, meta_*
      success: {
        type: 'object',
        properties: {
          description_text:  { type: 'string' },
          description_html:  { type: 'string' },
          sections:          { type: 'array', items: { type: 'object' } },
          raw_fields:        { type: 'object' },
          links:             { type: 'array', items: { type: 'object' } },
          body_text:         { type: 'string' },
          body_html:         { type: 'string' },
          meta_description:  { type: 'string' },
          meta_keywords:     { type: 'string' },
        },
        required: ['description_text', 'description_html', 'sections'],
      },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizePlaneOutput>> {
    const common   = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root     = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const sections = state.getMetadata<Section[]>('sections');
    if (common === undefined || root === undefined || sections === undefined) return NodeOutputBuilder.of('success');

    const trimmed = common.body_html.replace(/\s*<\/span>\s*$/i, '').trim();
    const raw_fields       = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
    const links            = common.links;
    const meta_description = extractMetaDescription(root);
    const meta_keywords    = extractMetaKeywords(root);

    state.output = state.output !== null
      ? {
        ...state.output,
        description_text:   trimmed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        description_html:   trimmed,
        sections:           filterLegacySections(sections),
        raw_fields,
        links,
        body_text:          common.body_text,
        body_html:          common.body_html,
        meta_description,
        meta_keywords,
      }
      : {
        description_text:   trimmed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        description_html:   trimmed,
        sections:           filterLegacySections(sections),
        raw_fields,
        links,
        body_text:          common.body_text,
        body_html:          common.body_html,
        meta_description,
        meta_keywords,
      };

    return NodeOutputBuilder.of('success');
  }
}
export const finalizePlaneNode = new FinalizePlaneNodeImpl();

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
};
