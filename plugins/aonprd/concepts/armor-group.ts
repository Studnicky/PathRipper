//
// Armor-group pages have well-defined structure; the inlined helpers fully
// cover the content shape.
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
  extractEntityId,
  filterLegacySections,
} from '../common.js';

// ─── Output type ─────────────────────────────────────────────────────────────

/** An armor listed under an armor group (empty by default — AON omits this list). */
export interface ArmorGroupArmor {
  name:     string;
  armor_id: number | null;
}

export interface ArmorGroupOutput {
  url:                         string;
  /** Numeric AON ArmorGroups.aspx ID extracted from the URL query string. */
  group_id:                    number | null;
  name:                        string;
  rarity:                      Rarity;
  pfs:                         PfsLegality | null;
  legacy:                      boolean;
  alt_edition_url:             string | null;
  traits:                      string[];
  trait_ids:                   Record<string, number>;
  source:                      { book: string | null; page: number | null; source_id: number | null };
  sources:                     SourceRef[];

  /** Armor specialization effect HTML (post-`<b>Source</b>`, pre-`<b>Armor</b>`). */
  armor_specialization_html:   string;
  /** Plain-text projection of `armor_specialization_html`. */
  armor_specialization_text:   string;
  /** Armors belonging to this group (usually empty — AON omits this list). */
  armors:                      ArmorGroupArmor[];

  // ─── Bookkeeping ───────────────────────────────────────────────────────────
  sections:                    Section[];
  raw_fields:                  Record<string, string>;
  links:                       LinkRef[];
  body_text:                   string;
  body_html:                   string;
  meta_description:            string | null;
  meta_keywords:               string | null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────────

export interface ArmorGroupBaseSlice {
  url:             string;
  group_id:        number | null;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          ArmorGroupOutput['source'];
  sources:         SourceRef[];
}

export interface ArmorGroupContentSlice {
  armor_specialization_html: string;
  armor_specialization_text: string;
  armors:                    ArmorGroupArmor[];
}

export interface ArmorGroupMetaSlice {
  __armor_group_meta_marked: true;
}

// ─── Span content parsing ─────────────────────────────────────────────────────

function splitContent(spanHtml: string): { specHtml: string; armorsHtml: string } {
  const headRe = /<b>\s*Source\s*<\/b>[\s\S]*?<br\s*\/?>/i;
  const head = headRe.exec(spanHtml);
  const afterSource = head !== null ? spanHtml.slice(head.index + head[0].length) : spanHtml;

  // Tail cut at the `<b>Armor</b>` / `<b>Armors</b>` label, when present.
  const armorsRe = /<b>\s*Armors?\s*<\/b>/i;
  const tail = armorsRe.exec(afterSource);
  if (tail === null) return { specHtml: afterSource.trim(), armorsHtml: '' };
  return {
    specHtml:   afterSource.slice(0, tail.index).trim(),
    armorsHtml: afterSource.slice(tail.index + tail[0].length).trim(),
  };
}

function parseArmors(armorsHtml: string): ArmorGroupArmor[] {
  const out: ArmorGroupArmor[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]*href=["'][^"']*Armor\.aspx\?ID=(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(armorsHtml)) !== null) {
    const id = parseInt(m[1]!, 10);
    const name = htmlToText(m[2] ?? '').trim();
    if (name === '') continue;
    const key = `${id}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, armor_id: Number.isFinite(id) ? id : null });
  }
  return out;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

export function extractArmorGroupBase(c: CommonExtraction): ArmorGroupBaseSlice {
  return {
    url:             c.url,
    group_id:        extractEntityId(c.url),
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

export function extractArmorGroupContent(
  _c:   CommonExtraction,
  $:    CheerioAPI,
  span: CheerioNode,
): ArmorGroupContentSlice {
  void $;
  void _c;
  const spanHtml = span.html() ?? '';
  const { specHtml, armorsHtml } = splitContent(spanHtml);
  return {
    armor_specialization_html: specHtml,
    armor_specialization_text: htmlToText(specHtml),
    armors:                    parseArmors(armorsHtml),
  };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Armor',
  'Armors',
];

export function finalizeArmorGroup(
  c:       CommonExtraction,
  base:    ArmorGroupBaseSlice,
  content: ArmorGroupContentSlice,
  $:       CheerioAPI,
  _target: CheerioNode,
): ArmorGroupOutput {
  void _target;
  const raw_fields = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    armor_specialization_html: content.armor_specialization_html,
    armor_specialization_text: content.armor_specialization_text,
    armors:                    content.armors,
    sections:                  c.sections,
    raw_fields,
    links:                     c.links,
    body_text:                 c.body_text,
    body_html:                 c.body_html,
    meta_description:          extractMetaDescription($),
    meta_keywords:             extractMetaKeywords($),
  } satisfies ArmorGroupOutput;
}

/**
 * Project an ArmorGroups.aspx page into a typed ArmorGroupOutput.
 *
 * Thin assembly wrapper for `parseAonHtml` direct-call paths and unit tests.
 */
export function extractArmorGroup(
  c:      CommonExtraction,
  $:      CheerioAPI,
  target: CheerioNode,
): ArmorGroupOutput {
  const base    = extractArmorGroupBase(c);
  const content = extractArmorGroupContent(c, $, target);
  return finalizeArmorGroup(c, base, content, $, target);
}

// Re-export output types so tests can import from here.
// ─── Helpers ─────────────────────────────────────────────────────────────────

/** AON labels claimed by armor-group capability nodes. */

// ─── Capability nodes ─────────────────────────────────────────────────────────

export type ArmorGroupBaseOutput = 'success' | 'error';

export const armorGroupBaseNode: NodeInterface<ScrapeState, ArmorGroupBaseOutput, RipperServices> = {
  name:    'extract:armor-group-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: ArmorGroupBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractArmorGroupBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type ArmorGroupContentOutput = 'success' | 'error';

export const armorGroupContentNode: NodeInterface<ScrapeState, ArmorGroupContentOutput, RipperServices> = {
  name:    'extract:armor-group-content',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: ArmorGroupContentOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'error' };

    const content = extractArmorGroupContent(c, $, target);

    state.output = { ...state.output, ...content };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeArmorGroupOutput = 'success';

export const finalizeArmorGroupNode: NodeInterface<ScrapeState, FinalizeArmorGroupOutput, RipperServices> = {
  name:    'finalize:armor-group',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'sections'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeArmorGroupOutput }> {
    const c        = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $        = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const sections = state.getMetadata<Section[]>('sections');
    if (c === undefined || $ === undefined || sections === undefined) return { output: 'success' };

    const raw_fields       = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
    const links            = c.links;
    const meta_description = extractMetaDescription($);
    const meta_keywords    = extractMetaKeywords($);

    state.output = state.output !== null
      ? {
        ...state.output,
        sections:         filterLegacySections(sections),
        raw_fields,
        links,
        body_text:        c.body_text,
        body_html:        c.body_html,
        meta_description,
        meta_keywords,
      }
      : {
        sections:         filterLegacySections(sections),
        raw_fields,
        links,
        body_text:        c.body_text,
        body_html:        c.body_html,
        meta_description,
        meta_keywords,
      };

    return { output: 'success' };
  },
};

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const armorGroupConcept: ConceptDecl<ArmorGroupOutput> = {
  id:       'armor-group',
  parent:   'entity',
  urlPaths: ['armorgroups'],
  capabilities: [
    armorGroupBaseNode,
    armorGroupContentNode,
    finalizeArmorGroupNode,
  ],
};
