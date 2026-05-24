// Weapon-group concept — Phase 6.4 taxonomic extraction.
//
// Delegates to Wave 5 slice helpers in weapon-group.ts for correctness.
// Byte-equivalent to Wave 5 shape — weapon-group pages have well-defined
// structure that is already fully captured by the Wave 5 helpers.
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

// ─── Inlined from Wave 5: weapon-group.ts ──────────────────────────────────
// ─── Output type ──────────────────────────────────────────────────────────────

/** A weapon listed under a weapon group. */
export interface WeaponGroupWeapon {
  /** Display name of the weapon. */
  name:      string;
  /** AON Weapons.aspx ID from the link, or null when absent. */
  weapon_id: number | null;
}

export interface WeaponGroupOutputFields {
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
export type WeaponGroupOutput = ConceptOutputBase<'weapon-group'> & WeaponGroupOutputFields;

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
  source:          WeaponGroupOutputFields['source'];
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
  const re = /<a[^>]*href=["'][^"']*Weapons\.aspx\?ID=(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(weaponsHtml)) !== null) {
    const id = parseInt(m[1]!, 10);
    const name = htmlToText(m[2] ?? '').trim();
    if (name === '') continue;
    const key = `${id}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, weapon_id: Number.isFinite(id) ? id : null });
  }
  return out;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract base identity + header scalars for a weapon-group page. */
export function extractWeaponGroupBase(c: CommonExtraction): WeaponGroupBaseSlice {
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

/** Extract critical-specialization prose + weapons list from the span. */
export function extractWeaponGroupContent(
  _c:   CommonExtraction,
  $:    CheerioAPI,
  span: CheerioNode,
): WeaponGroupContentSlice {
  void $;
  void _c;
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
  c:       CommonExtraction,
  base:    WeaponGroupBaseSlice,
  content: WeaponGroupContentSlice,
  $:       CheerioAPI,
  _target: CheerioNode,
): WeaponGroupOutputFields {
  void _target;
  const raw_fields = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    critical_specialization_html: content.critical_specialization_html,
    critical_specialization_text: content.critical_specialization_text,
    weapons:                      content.weapons,
    sections:                     c.sections,
    raw_fields,
    links:                        c.links,
    body_text:                    c.body_text,
    body_html:                    c.body_html,
    meta_description:             extractMetaDescription($),
    meta_keywords:                extractMetaKeywords($),
  } satisfies WeaponGroupOutputFields;
}

/**
 * Project a WeaponGroups.aspx page into a typed WeaponGroupOutput.
 *
 * Thin assembly wrapper for `parseAonHtml` direct-call paths and unit tests.
 */
export function extractWeaponGroup(
  c:      CommonExtraction,
  $:      CheerioAPI,
  target: CheerioNode,
): WeaponGroupOutputFields {
  const base    = extractWeaponGroupBase(c);
  const content = extractWeaponGroupContent(c, $, target);
  return finalizeWeaponGroup(c, base, content, $, target);
}


// Re-export output types so tests can import from here.
// ─── Helpers ─────────────────────────────────────────────────────────────────

/** AON labels claimed by weapon-group capability nodes. */

// ─── Capability nodes ─────────────────────────────────────────────────────────

export type WeaponGroupBaseOutput = 'success' | 'error';

export const weaponGroupBaseNode: NodeInterface<ScrapeState, WeaponGroupBaseOutput, RipperServices> = {
  name:    'extract:weapon-group-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: WeaponGroupBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractWeaponGroupBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type WeaponGroupContentOutput = 'success' | 'error';

export const weaponGroupContentNode: NodeInterface<ScrapeState, WeaponGroupContentOutput, RipperServices> = {
  name:    'extract:weapon-group-content',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: WeaponGroupContentOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'error' };

    const content = extractWeaponGroupContent(c, $, target);

    state.output = { ...state.output, ...content };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeWeaponGroupOutput = 'success';

export const finalizeWeaponGroupNode: NodeInterface<ScrapeState, FinalizeWeaponGroupOutput, RipperServices> = {
  name:    'finalize:weapon-group',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'sections'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeWeaponGroupOutput }> {
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

export const weaponGroupConcept: ConceptDecl<WeaponGroupOutput> = {
  id:       'weapon-group',
  parent:   'entity',
  urlPaths: ['weapongroups'],
  capabilities: [
    weaponGroupBaseNode,
    weaponGroupContentNode,
    finalizeWeaponGroupNode,
  ],
  discriminator: { _type: 'weapon-group' },
};
