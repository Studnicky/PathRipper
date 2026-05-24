//
// Two decomposed slices: base (identity + sources) and contents (Price, Bulk,
// Money Left Over scalars + Armor/Weapons/Gear/Options item lists).
// Finalize assembles raw_fields + meta.
//
// equipment-list slices for downstream consumers without re-running the full
// pipeline.
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
  const re = /<b>([\s\S]*?)<\/b>([\s\S]*?)(?=<b>|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const labelHtml = m[1] ?? '';
    const valueHtml = m[2] ?? '';
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
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(valueHtml)) !== null) {
    const href = m[1] ?? '';
    const inner = m[2] ?? '';
    const trailing = m[3] ?? '';
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
export function extractClassKitBase(c: CommonExtraction): ClassKitBaseSlice {
  return {
    url:             c.url,
    class_kit_id:    extractEntityId(c.url),
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
 * Extract Price / Bulk / Money Left Over scalars and Armor / Weapons / Gear /
 * Options item lists from the page body. Labels live in `body_html` because
 * ClassKits pages carry no `<hr/>` separator.
 */
export function extractClassKitContents(c: CommonExtraction): ClassKitContentsSlice {
  const labels = harvestBoldLabelsHtml(c.body_html);
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
export function extractClassKitMeta(_c: CommonExtraction): ClassKitMetaSlice {
  return { __class_kit_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source', 'Price', 'Bulk', 'Money Left Over',
  'Armor', 'Weapons', 'Gear', 'Options',
];

export function finalizeClassKit(
  c:        CommonExtraction,
  base:     ClassKitBaseSlice,
  contents: ClassKitContentsSlice,
  _meta:    ClassKitMetaSlice,
  $:        CheerioAPI,
  _target:  CheerioNode,
): ClassKitOutput {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    ...contents,
    sections:         c.sections,
    raw_fields,
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
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
  c:      CommonExtraction,
  $:      CheerioAPI,
  target: CheerioNode,
): ClassKitOutput {
  const base     = extractClassKitBase(c);
  const contents = extractClassKitContents(c);
  const meta     = extractClassKitMeta(c);
  return finalizeClassKit(c, base, contents, meta, $, target);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

// Node: extract:class-kit-base
// Identity + sources slice.

export type ClassKitBaseOutput = 'success' | 'error';

export const classKitBaseNode: NodeInterface<ScrapeState, ClassKitBaseOutput, RipperServices> = {
  name:    'extract:class-kit-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: ClassKitBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractClassKitBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:class-kit-contents
// Price, Bulk, Money Left Over scalars + Armor/Weapons/Gear/Options lists.

export type ClassKitContentsOutput = 'success' | 'error';

export const classKitContentsNode: NodeInterface<ScrapeState, ClassKitContentsOutput, RipperServices> = {
  name:    'extract:class-kit-contents',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: ClassKitContentsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const slice = extractClassKitContents(c);

    state.output = { ...state.output, ...slice };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: finalize:class-kit
// Assembles raw_fields + sections + meta tags.

export type FinalizeClassKitOutput = 'success';

export const finalizeClassKitNode: NodeInterface<ScrapeState, FinalizeClassKitOutput, RipperServices> = {
  name:    'finalize:class-kit',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeClassKitOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };

    const meta     = { __class_kit_meta_marked: true as const };
    const acc = (state.output ?? {}) as unknown as ClassKitOutput;
    const assembled = finalizeClassKit(c, acc, acc, meta, $, target);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

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
