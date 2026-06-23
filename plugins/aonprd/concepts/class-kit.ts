//
// Two decomposed slices: base (identity + sources) and contents (Price, Bulk,
// Money Left Over scalars + Armor/Weapons/Gear/Options item lists).
// Finalize assembles raw_fields + meta.
//
// equipment-list slices for downstream consumers without re-running the full
// pipeline.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { ConceptDecl } from '../../../src/taxonomy/Taxonomy.js';
import { setConceptOutput } from './_helpers.js';
import {
  CAPABILITY_OUTPUTS,
  type CommonExtraction,
  type CheerioNode,
  type LinkRef,
  type Rarity,
  type PfsLegality,
  type Section,
  type SourceRef,
  htmlToText,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';


// ─── Output type ──────────────────────────────────────────────────────────────

/** A linked equipment reference harvested from one of the kit lists. */
export interface ClassKitItem {
  /** Display name (e.g. "studded leather armor"). */
  name:     string;
  /** Source `.aspx` path component — `Armor`, `Weapons`, `Equipment`. */
  kind:     string;
  /** Numeric `?ID=` value from the anchor, when present. */
  item_id:  number | null;
  /** Trailing parenthesised annotation (e.g. "2 gp" from Options entries). */
  note:     string | null;
}

export interface ClassKitOutput {
  url:              string;
  /** Numeric AON ClassKits.aspx ID extracted from the URL query string. */
  class_kit_id:     number | null;
  name:             string;
  rarity:           Rarity;
  pfs:              PfsLegality | null;
  legacy:           boolean;
  alt_edition_url:  string | null;
  traits:           string[];
  trait_ids:        Record<string, number>;
  source:           { book: string | null; page: number | null; source_id: number | null };
  sources:          SourceRef[];

  // ─── Contents ─────────────────────────────────────────────────────────────
  /** Price scalar — verbatim "8 gp, 4 sp, 2 cp" string. */
  price:            string | null;
  /** Bulk scalar — verbatim "3 Bulk, 7 light" string. */
  bulk:             string | null;
  /** Money Left Over scalar — verbatim "6 gp, 5 sp, 8 cp" string. */
  money_left_over:  string | null;
  /** Armor items. */
  armor:            ClassKitItem[];
  /** Weapons items. */
  weapons:          ClassKitItem[];
  /** Gear items (Equipment.aspx links). */
  gear:             ClassKitItem[];
  /** Options items with their `(N gp)` cost annotations preserved. */
  options:          ClassKitItem[];

  // ─── Bookkeeping ──────────────────────────────────────────────────────────
  sections:             Section[];
  raw_fields:           Record<string, string>;
  links:                LinkRef[];
  body_text:            string;
  body_html:            string;
  /** `<meta name="description">` content. */
  meta_description:     string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords:        string | null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────────

/** Fields owned by `extract-class-kit-base`. */
export interface ClassKitBaseSlice {
  url:             string;
  class_kit_id:    number | null;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          ClassKitOutput['source'];
  sources:         SourceRef[];
}

/** Fields owned by `extract-class-kit-contents`. */
export interface ClassKitContentsSlice {
  price:           string | null;
  bulk:            string | null;
  money_left_over: string | null;
  armor:           ClassKitItem[];
  weapons:         ClassKitItem[];
  gear:            ClassKitItem[];
  options:         ClassKitItem[];
}

/** Fields owned by `extract-class-kit-meta`. */
export interface ClassKitMetaSlice {
  /** Marker so `state.output` accumulates the slice. */
  __class_kit_meta_marked: true;
}

// ─── Label harvesting ────────────────────────────────────────────────────────

/**
 * Harvest `<b>Label</b> Value` pairs from a fragment, preserving each value's
 * verbatim HTML so downstream parsers can walk the inline anchors. Stops the
 * current value at the next `<b>` or end of fragment.
 */
function harvestBoldLabelsHtml(html: string): Map<string, string> {
  const out = new Map<string, string>();
  const regex = /<b>([\s\S]*?)<\/b>([\s\S]*?)(?=<b>|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const labelHtml = match[1] ?? '';
    const valueHtml = match[2] ?? '';
    const label = htmlToText(labelHtml).replace(/[:?]$/, '').trim();
    if (label === '') continue;
    const key = label.toLowerCase();
    if (!out.has(key)) out.set(key, valueHtml.trim());
  }
  return out;
}

/** Project a label value into a string, trimming leading punctuation and `;` tails. */
function cleanScalar(valueHtml: string | undefined): string | null {
  if (valueHtml === undefined) return null;
  const text = htmlToText(valueHtml).replace(/^[\s;,:]+|[\s;,]+$/g, '');
  return text === '' ? null : text;
}

/**
 * Walk anchors in a value fragment, emitting one ClassKitItem per `<a>`. The
 * trailing token between a `</a>` and the next `<a>` (or end of fragment) is
 * captured as a parenthesised `note` when it matches `(…)`.
 */
function parseItemList(valueHtml: string | undefined): ClassKitItem[] {
  if (valueHtml === undefined) return [];
  const out: ClassKitItem[] = [];
  const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a\b|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(valueHtml)) !== null) {
    const href = match[1] ?? '';
    const inner = match[2] ?? '';
    const trailing = match[3] ?? '';
    const name = htmlToText(inner);
    if (name === '') continue;
    const aspxMatch = /([A-Za-z][A-Za-z0-9]*)\.aspx/.exec(href);
    const kind = aspxMatch !== null ? aspxMatch[1]! : '';
    const idMatch = /[?&]ID=(\d+)/i.exec(href);
    const item_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    const noteMatch = /\(([^)]+)\)/.exec(htmlToText(trailing));
    const note = noteMatch !== null ? noteMatch[1]!.trim() : null;
    out.push({
      name,
      kind,
      item_id: item_id !== null && Number.isFinite(item_id) ? item_id : null,
      note,
    });
  }
  return out;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract base identity + header scalars for a class kit page. */
export function extractClassKitBase(common: CommonExtraction): ClassKitBaseSlice {
  return {
    url:             common.url,
    class_kit_id:    extractEntityId(common.url),
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
 * Extract Price / Bulk / Money Left Over scalars and Armor / Weapons / Gear /
 * Options item lists from the page body. Labels live in `body_html` because
 * ClassKits pages carry no `<hr/>` separator.
 */
export function extractClassKitContents(common: CommonExtraction): ClassKitContentsSlice {
  const labels = harvestBoldLabelsHtml(common.body_html);
  return {
    price:           cleanScalar(labels.get('price')),
    bulk:            cleanScalar(labels.get('bulk')),
    money_left_over: cleanScalar(labels.get('money left over')),
    armor:           parseItemList(labels.get('armor')),
    weapons:         parseItemList(labels.get('weapons')),
    gear:            parseItemList(labels.get('gear')),
    options:         parseItemList(labels.get('options')),
  };
}

/** Extract meta slice marker — sections/links/body/meta attach in finalize. */
export function extractClassKitMeta(_common: CommonExtraction): ClassKitMetaSlice {
  return { __class_kit_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source', 'Price', 'Bulk', 'Money Left Over',
  'Armor', 'Weapons', 'Gear', 'Options',
];

export function finalizeClassKit(
  common:   CommonExtraction,
  base:     ClassKitBaseSlice,
  contents: ClassKitContentsSlice,
  _meta:    ClassKitMetaSlice,
  root:     CheerioAPI,
  _target:  CheerioNode,
): ClassKitOutput {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    ...contents,
    sections:         common.sections,
    raw_fields,
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies ClassKitOutput;
}

/**
 * Project a ClassKits.aspx page into a typed ClassKitOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through
 * the decomposed class-kit extraction nodes.
 */
export function extractClassKit(
  common:  CommonExtraction,
  root:    CheerioAPI,
  target:  CheerioNode,
): ClassKitOutput {
  const base     = extractClassKitBase(common);
  const contents = extractClassKitContents(common);
  const meta     = extractClassKitMeta(common);
  return finalizeClassKit(common, base, contents, meta, root, target);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

// Node: extract:class-kit-base
// Identity + sources slice.

export type ClassKitBaseOutput = 'success' | 'error';

class ClassKitBaseNodeImpl extends ScalarNode<ScrapeState, ClassKitBaseOutput> {
  public readonly name = 'extract:class-kit-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<ClassKitBaseOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: {
            type: 'object',
            properties: {
              url:             { type: 'string' },
              class_kit_id:    { type: ['integer', 'null'] },
              name:            { type: 'string' },
              rarity:          { type: 'string' },
              pfs:             { type: ['string', 'null'] },
              legacy:          { type: 'boolean' },
              alt_edition_url: { type: ['string', 'null'] },
              traits:          { type: 'array', items: { type: 'string' } },
              trait_ids:       { type: 'object' },
              source:          { type: 'object' },
              sources:         { type: 'array', items: { type: 'object' } },
            },
            required: ['url', 'name', 'rarity', 'traits', 'trait_ids', 'source', 'sources'],
          },
        },
        required: ['output'],
      },
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<ClassKitBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractClassKitBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}
export const classKitBaseNode = new ClassKitBaseNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:class-kit-contents
// Price, Bulk, Money Left Over scalars + Armor/Weapons/Gear/Options lists.

export type ClassKitContentsOutput = 'success' | 'error';

class ClassKitContentsNodeImpl extends ScalarNode<ScrapeState, ClassKitContentsOutput> {
  public readonly name = 'extract:class-kit-contents';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<ClassKitContentsOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: {
            type: 'object',
            properties: {
              price:           { type: ['string', 'null'] },
              bulk:            { type: ['string', 'null'] },
              money_left_over: { type: ['string', 'null'] },
              armor:           { type: 'array', items: { type: 'object' } },
              weapons:         { type: 'array', items: { type: 'object' } },
              gear:            { type: 'array', items: { type: 'object' } },
              options:         { type: 'array', items: { type: 'object' } },
            },
            required: ['armor', 'weapons', 'gear', 'options'],
          },
        },
        required: ['output'],
      },
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<ClassKitContentsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const slice = extractClassKitContents(common);

    state.output = { ...state.output, ...slice };

    return NodeOutputBuilder.of('success');
  }
}
export const classKitContentsNode = new ClassKitContentsNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

// Node: finalize:class-kit
// Assembles raw_fields + sections + meta tags.

export type FinalizeClassKitOutput = 'success';

class FinalizeClassKitNodeImpl extends ScalarNode<ScrapeState, FinalizeClassKitOutput> {
  public readonly name = 'finalize:class-kit';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<FinalizeClassKitOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: { type: 'object' },
        },
        required: ['output'],
      },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeClassKitOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('success');

    const meta     = { __class_kit_meta_marked: true as const };
    const acc = (state.output ?? {}) as unknown as ClassKitOutput;
    const assembled = finalizeClassKit(common, acc, acc, meta, root, target);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}
export const finalizeClassKitNode = new FinalizeClassKitNodeImpl();

// ─── ConceptDecl export ───────────────────────────────────────────────────────

/**
 * Class-kit concept declaration for the AONPRD taxonomy.
 * Imported by `plugins/aonprd/taxonomy/aonprd.ts`.
 */
export const classKitConcept: ConceptDecl<ClassKitOutput> = {
  id:       'class-kit',
  parent:   'entity',
  urlPaths: ['classkits'],
  capabilities: [
    classKitBaseNode,
    classKitContentsNode,
    finalizeClassKitNode,
  ],
};
