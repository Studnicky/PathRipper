//
// Weapon-group pages have well-defined structure; the inlined helpers fully
// cover the content shape.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { ConceptDecl } from '../taxonomy.js';
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

/** A weapon listed under a weapon group. */
export interface WeaponGroupWeapon {
  /** Display name of the weapon. */
  name:      string;
  /** AON Weapons.aspx ID from the link, or null when absent. */
  weapon_id: number | null;
}

export interface WeaponGroupOutput {
  url:                          string;
  /** Numeric AON WeaponGroups.aspx ID extracted from the URL query string. */
  group_id:                     number | null;
  name:                         string;
  rarity:                       Rarity;
  pfs:                          PfsLegality | null;
  legacy:                       boolean;
  alt_edition_url:              string | null;
  traits:                       string[];
  trait_ids:                    Record<string, number>;
  source:                       { book: string | null; page: number | null; source_id: number | null };
  sources:                      SourceRef[];

  /** Critical specialization effect HTML (post-`<b>Source</b>`, pre-`<b>Weapons</b>`). */
  critical_specialization_html: string;
  /** Plain-text projection of `critical_specialization_html`. */
  critical_specialization_text: string;
  /** Weapons belonging to this group, in source order. */
  weapons:                      WeaponGroupWeapon[];

  // ─── Bookkeeping ───────────────────────────────────────────────────────────
  sections:                     Section[];
  raw_fields:                   Record<string, string>;
  links:                        LinkRef[];
  body_text:                    string;
  body_html:                    string;
  meta_description:             string | null;
  meta_keywords:                string | null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────────

/** Fields owned by `extract-weapon-group-base`. */
export interface WeaponGroupBaseSlice {
  url:             string;
  group_id:        number | null;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          WeaponGroupOutput['source'];
  sources:         SourceRef[];
}

/** Fields owned by `extract-weapon-group-content`. */
export interface WeaponGroupContentSlice {
  critical_specialization_html: string;
  critical_specialization_text: string;
  weapons:                      WeaponGroupWeapon[];
}

/** Fields owned by `finalize-weapon-group` — terminal marker only. */
export interface WeaponGroupMetaSlice {
  __weapon_group_meta_marked: true;
}

// ─── Span content parsing ─────────────────────────────────────────────────────

/**
 * Cut the content span into critical-specialization prose (after the Source line)
 * and the optional `<b>Weapons</b>` list trailing it.
 */
function splitContent(spanHtml: string): { specHtml: string; weaponsHtml: string } {
  // Head cut: skip past the page title `<h1 class="title">` and the
  // `<b>Source</b> … <br/>` line.
  const headRe = /<b>\s*Source\s*<\/b>[\s\S]*?<br\s*\/?>/i;
  const head = headRe.exec(spanHtml);
  const afterSource = head !== null ? spanHtml.slice(head.index + head[0].length) : spanHtml;

  // Tail cut at the `<b>Weapons</b>` label, when present.
  const weaponsRe = /<b>\s*Weapons?\s*<\/b>/i;
  const tail = weaponsRe.exec(afterSource);
  if (tail === null) return { specHtml: afterSource.trim(), weaponsHtml: '' };
  return {
    specHtml:    afterSource.slice(0, tail.index).trim(),
    weaponsHtml: afterSource.slice(tail.index + tail[0].length).trim(),
  };
}

/** Parse the weapon list from the post-`<b>Weapons</b>` HTML. */
function parseWeapons(weaponsHtml: string): WeaponGroupWeapon[] {
  const out: WeaponGroupWeapon[] = [];
  const seen = new Set<string>();
  const regex = /<a[^>]*href=["'][^"']*Weapons\.aspx\?ID=(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(weaponsHtml)) !== null) {
    const weaponId = parseInt(match[1]!, 10);
    const name = htmlToText(match[2] ?? '').trim();
    if (name === '') continue;
    const key = `${weaponId}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, weapon_id: Number.isFinite(weaponId) ? weaponId : null });
  }
  return out;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract base identity + header scalars for a weapon-group page. */
export function extractWeaponGroupBase(common: CommonExtraction): WeaponGroupBaseSlice {
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

/** Extract critical-specialization prose + weapons list from the span. */
export function extractWeaponGroupContent(
  _common: CommonExtraction,
  _root:   CheerioAPI,
  span:    CheerioNode,
): WeaponGroupContentSlice {
  void _root;
  void _common;
  const spanHtml = span.html() ?? '';
  const { specHtml, weaponsHtml } = splitContent(spanHtml);
  return {
    critical_specialization_html: specHtml,
    critical_specialization_text: htmlToText(specHtml),
    weapons:                      parseWeapons(weaponsHtml),
  };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Weapons',
  'Weapon',
];

export function finalizeWeaponGroup(
  common:  CommonExtraction,
  base:    WeaponGroupBaseSlice,
  content: WeaponGroupContentSlice,
  root:    CheerioAPI,
  _target: CheerioNode,
): WeaponGroupOutput {
  void _target;
  const raw_fields = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    critical_specialization_html: content.critical_specialization_html,
    critical_specialization_text: content.critical_specialization_text,
    weapons:                      content.weapons,
    sections:                     common.sections,
    raw_fields,
    links:                        common.links,
    body_text:                    common.body_text,
    body_html:                    common.body_html,
    meta_description:             extractMetaDescription(root),
    meta_keywords:                extractMetaKeywords(root),
  } satisfies WeaponGroupOutput;
}

/**
 * Project a WeaponGroups.aspx page into a typed WeaponGroupOutput.
 *
 * Thin assembly wrapper for `parseAonHtml` direct-call paths and unit tests.
 */
export function extractWeaponGroup(
  common: CommonExtraction,
  root:   CheerioAPI,
  target: CheerioNode,
): WeaponGroupOutput {
  const base    = extractWeaponGroupBase(common);
  const content = extractWeaponGroupContent(common, root, target);
  return finalizeWeaponGroup(common, base, content, root, target);
}

// Re-export output types so tests can import from here.
// ─── Helpers ─────────────────────────────────────────────────────────────────

/** AON labels claimed by weapon-group capability nodes. */

// ─── Capability nodes ─────────────────────────────────────────────────────────

export type WeaponGroupBaseOutput = 'success' | 'error';

class WeaponGroupBaseNodeImpl extends ScalarNode<ScrapeState, WeaponGroupBaseOutput> {
  public readonly name = 'extract:weapon-group-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<WeaponGroupBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractWeaponGroupBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}
export const weaponGroupBaseNode = new WeaponGroupBaseNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type WeaponGroupContentOutput = 'success' | 'error';

class WeaponGroupContentNodeImpl extends ScalarNode<ScrapeState, WeaponGroupContentOutput> {
  public readonly name = 'extract:weapon-group-content';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<WeaponGroupContentOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root   = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('error');

    const content = extractWeaponGroupContent(common, root, target);

    state.output = { ...state.output, ...content };

    return NodeOutputBuilder.of('success');
  }
}
export const weaponGroupContentNode = new WeaponGroupContentNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeWeaponGroupOutput = 'success';

class FinalizeWeaponGroupNodeImpl extends ScalarNode<ScrapeState, FinalizeWeaponGroupOutput> {
  public readonly name = 'finalize:weapon-group';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeWeaponGroupOutput>> {
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
export const finalizeWeaponGroupNode = new FinalizeWeaponGroupNodeImpl();

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const weaponGroupConcept: ConceptDecl<WeaponGroupOutput> = {
  id:       'weapon-group',
  parent:   'entity',
  urlPaths: ['weapongroups'],
  capabilities: [
    weaponGroupBaseNode,
    weaponGroupContentNode,
    finalizeWeaponGroupNode,
  ],
};
