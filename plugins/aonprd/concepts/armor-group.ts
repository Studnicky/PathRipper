//
// Armor-group pages have well-defined structure; the inlined helpers fully
// cover the content shape.
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
  const regex = /<a[^>]*href=["'][^"']*Armor\.aspx\?ID=(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(armorsHtml)) !== null) {
    const armorId = parseInt(match[1]!, 10);
    const name = htmlToText(match[2] ?? '').trim();
    if (name === '') continue;
    const key = `${armorId}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, armor_id: Number.isFinite(armorId) ? armorId : null });
  }
  return out;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

export function extractArmorGroupBase(common: CommonExtraction): ArmorGroupBaseSlice {
  return {
    url:             common.url,
    group_id:        extractEntityId(common.url),
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

export function extractArmorGroupContent(
  _common: CommonExtraction,
  root:    CheerioAPI,
  span:    CheerioNode,
): ArmorGroupContentSlice {
  void root;
  void _common;
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
  common:  CommonExtraction,
  base:    ArmorGroupBaseSlice,
  content: ArmorGroupContentSlice,
  root:    CheerioAPI,
  _target: CheerioNode,
): ArmorGroupOutput {
  void _target;
  const raw_fields = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    armor_specialization_html: content.armor_specialization_html,
    armor_specialization_text: content.armor_specialization_text,
    armors:                    content.armors,
    sections:                  common.sections,
    raw_fields,
    links:                     common.links,
    body_text:                 common.body_text,
    body_html:                 common.body_html,
    meta_description:          extractMetaDescription(root),
    meta_keywords:             extractMetaKeywords(root),
  } satisfies ArmorGroupOutput;
}

/**
 * Project an ArmorGroups.aspx page into a typed ArmorGroupOutput.
 *
 * Thin assembly wrapper for `parseAonHtml` direct-call paths and unit tests.
 */
export function extractArmorGroup(
  common: CommonExtraction,
  root:   CheerioAPI,
  target: CheerioNode,
): ArmorGroupOutput {
  const base    = extractArmorGroupBase(common);
  const content = extractArmorGroupContent(common, root, target);
  return finalizeArmorGroup(common, base, content, root, target);
}

// Re-export output types so tests can import from here.
// ─── Helpers ─────────────────────────────────────────────────────────────────

/** AON labels claimed by armor-group capability nodes. */

// ─── Capability nodes ─────────────────────────────────────────────────────────

export type ArmorGroupBaseOutput = 'success' | 'error';

class ArmorGroupBaseNode extends ScalarNode<ScrapeState, ArmorGroupBaseOutput> {
  public readonly name = 'extract:armor-group-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<ArmorGroupBaseOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: {
            type: 'object',
            properties: {
              url:             { type: 'string' },
              group_id:        { type: ['integer', 'null'] },
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
  ): Promise<NodeOutputType<ArmorGroupBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractArmorGroupBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const armorGroupBaseNode = new ArmorGroupBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

export type ArmorGroupContentOutput = 'success' | 'error';

class ArmorGroupContentNode extends ScalarNode<ScrapeState, ArmorGroupContentOutput> {
  public readonly name = 'extract:armor-group-content';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<ArmorGroupContentOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: {
            type: 'object',
            properties: {
              armor_specialization_html: { type: 'string' },
              armor_specialization_text: { type: 'string' },
              armors: { type: 'array', items: { type: 'object' } },
            },
            required: ['armor_specialization_html', 'armor_specialization_text', 'armors'],
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
  ): Promise<NodeOutputType<ArmorGroupContentOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('error');

    const content = extractArmorGroupContent(common, root, target);

    state.output = { ...state.output, ...content };

    return NodeOutputBuilder.of('success');
  }
}

export const armorGroupContentNode = new ArmorGroupContentNode();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeArmorGroupOutput = 'success';

class FinalizeArmorGroupNode extends ScalarNode<ScrapeState, FinalizeArmorGroupOutput> {
  public readonly name = 'finalize:armor-group';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<FinalizeArmorGroupOutput, SchemaObjectType> {
    return {
      // `success` — merges sections, raw_fields, links, body_text, body_html, meta into state.output (no setConceptOutput call).
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
  ): Promise<NodeOutputType<FinalizeArmorGroupOutput>> {
    const common   = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root     = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const sections = state.getMetadata<Section[]>('sections');
    if (common === undefined || root === undefined || sections === undefined) return NodeOutputBuilder.of('success');

    const raw_fields       = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
    const links            = common.links;
    const meta_description = extractMetaDescription(root);
    const meta_keywords    = extractMetaKeywords(root);

    state.output = state.output !== null
      ? {
        ...state.output,
        sections:         filterLegacySections(sections),
        raw_fields,
        links,
        body_text:        common.body_text,
        body_html:        common.body_html,
        meta_description,
        meta_keywords,
      }
      : {
        sections:         filterLegacySections(sections),
        raw_fields,
        links,
        body_text:        common.body_text,
        body_html:        common.body_html,
        meta_description,
        meta_keywords,
      };

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeArmorGroupNode = new FinalizeArmorGroupNode();

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
