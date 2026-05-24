// Ancestry concept — Phase 6.4 taxonomic extraction.
//
// Delegates to Wave 5 slice helpers in ancestry.ts for correctness.
// Four decomposed slices: base (identity + mechanics + popular edicts/anathema),
// heritages (h2 heritage sections), features (initial proficiencies + feature
// sections), and finalize (raw_fields + meta). Chrome filtering: no legacy
// section filtering is applied here (ancestry pages don't typically carry the
// legacy-content-warning heading).
//
// Improvement vs Wave 5: structured slices exposed as individual nodes allow
// partial extraction and incremental composition in the taxonomy pipeline.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../src/services/RipperServices.js';
import type { ConceptDecl, ConceptOutputBase } from '../taxonomy.js';
import { setConceptOutput } from './_helpers.js';
import { parseGrantedFeatures } from '../capabilities/grantedFeatures.js';
import {
  CAPABILITY_OUTPUTS,
  type CommonExtraction,
  type CheerioNode,
  type LinkRef,
  type Rarity,
  type PfsLegality,
  type Section,
  type SourceRef,
  getField,
  htmlToText,
  asInt,
  splitTopLevel,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';

// ─── Inlined from Wave 5: ancestry.ts ──────────────────────────────────
// ─── Output shape ─────────────────────────────────────────────────────────────

export interface AncestryMechanics {
  hit_points:        number | null;
  size:              string | null;
  speed:             number | null;
  attribute_boosts:  string[];
  attribute_flaws:   string[];
  languages: {
    fixed:        string[];
    bonus_choice: string[];
    raw:          string | null;
  };
  vision:            string | null;
  granted:           string[];
}

export interface AncestryOutputFields {
  url:                   string;
  ancestry_id:             number | null;
  name:                  string;
  rarity:                Rarity;
  pfs:                   PfsLegality | null;
  legacy:                boolean;
  alt_edition_url:       string | null;
  traits:                string[];
  trait_ids:             Record<string, number>;
  source:                { book: string | null; page: number | null; source_id: number | null };
  sources:               SourceRef[];
  sections:              Section[];
  raw_fields:            Record<string, string>;
  links:                 LinkRef[];
  body_text:             string;
  body_html:             string;
  meta_description:      string | null;
  meta_keywords:         string | null;
  mechanics:             AncestryMechanics;
  popular_edicts:        string | null;
  popular_anathema:      string | null;
  /** Heritages discovered as `<h2>Heritage Name</h2>` sections under the ancestry. */
  heritages:             Array<{ name: string; description: string }>;
  /** Initial proficiencies keyed by category (e.g. Perception, Saving Throws). */
  initial_proficiencies: Record<string, string>;
  /** Free-form ancestry feature sections (anything h2 not claimed by mechanics). */
  features:              Array<{ name: string; description: string }>;
}

/** Full output shape — `_type` discriminator stamped by the router at chain entry. */
export type AncestryOutput = ConceptOutputBase<'ancestry'> & AncestryOutputFields;

// ─── Per-slice shapes ─────────────────────────────────────────────────────────

export interface AncestryBaseSlice {
  url:             string;
  ancestry_id:       number | null;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          { book: string | null; page: number | null; source_id: number | null };
  sources:         SourceRef[];
  mechanics:       AncestryMechanics;
  popular_edicts:  string | null;
  popular_anathema: string | null;
}

export interface AncestryHeritagesSlice {
  heritages: Array<{ name: string; description: string }>;
}

export interface AncestryFeaturesSlice {
  initial_proficiencies: Record<string, string>;
  features:              Array<{ name: string; description: string }>;
}

export interface AncestryMetaSlice {
  sections: Section[];
}

// ─── Known labels (for raw_fields strip) ──────────────────────────────────────

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source', 'Hit Points', 'Size', 'Speed', 'Languages',
  'Attribute Boosts', 'Attribute Boost', 'Ability Boosts', 'Ability Boost',
  'Attribute Flaw', 'Attribute Flaws', 'Ability Flaw', 'Ability Flaws',
  'Vision', 'Low-Light Vision', 'Darkvision',
  'Popular Edicts', 'Popular Anathema',
  // Rare per-page metadata.
  'Ancestry Page', 'Frequency',
];

const SIZE_WORDS = new Set(['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan']);

// ─── Section-body helpers (modern h2 layout) ──────────────────────────────────

/**
 * Read a section body value for ancestry mechanic sections.
 * `<h2 class="title">Label</h2>VALUE<br />` returns VALUE as text.
 */
function readSectionValue(html: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<h[23][^>]+class="title"[^>]*>\\s*${escaped}\\s*<\\/h[23]>\\s*([\\s\\S]*?)(?=<h[23]|$)`, 'i');
  const m = re.exec(html);
  if (m === null) return null;
  return htmlToText(m[1] ?? '');
}

/**
 * Read a section body as a list — splits on `<br />` before stripping HTML so
 * each line element becomes its own entry. Used for Attribute Boosts/Flaws on
 * modern AON ancestry pages where boosts are listed one per `<br />`.
 */
function readSectionList(html: string, label: string): string[] | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<h[23][^>]+class="title"[^>]*>\\s*${escaped}\\s*<\\/h[23]>\\s*([\\s\\S]*?)(?=<h[23]|$)`, 'i');
  const m = re.exec(html);
  if (m === null) return null;
  return (m[1] ?? '')
    .split(/<br\s*\/?>/i)
    .map((chunk) => htmlToText(chunk))
    .filter((t) => t !== '');
}

/** Find inline `<b>Marker</b> VALUE` followed by next-bold or heading boundary. */
function findInlineMarker(html: string, label: string): string | null {
  const re = new RegExp(`<b>\\s*${label}\\s*<\\/b>\\s*([\\s\\S]*?)(?=<b>|<h[1-6]|<hr|$)`, 'i');
  const m = re.exec(html);
  return m === null ? null : htmlToText(m[1] ?? '');
}

function parseLanguages(value: string | null): AncestryMechanics['languages'] {
  if (value === null) return { fixed: [], bonus_choice: [], raw: null };
  const parts = splitTopLevel(value, ',');
  const fixed: string[] = [];
  const bonus_choice: string[] = [];
  for (const p of parts) {
    if (/intelligence|bonus|additional|number you can speak|chose/i.test(p)) {
      bonus_choice.push(p.trim());
    } else if (p.trim() !== '') {
      fixed.push(p.trim());
    }
  }
  return { fixed, bonus_choice, raw: value };
}

function findVision(sections: ReadonlyArray<Section>): string | null {
  for (const s of sections) {
    const lc = s.heading.toLowerCase();
    if (lc.includes('darkvision') || lc.includes('low-light vision') || lc.includes('vision')) {
      return s.heading;
    }
  }
  return null;
}

// ─── Slice extraction ─────────────────────────────────────────────────────────

/** Extract identity + mechanics + popular edicts/anathema. */
export function extractAncestryBase(c: CommonExtraction, _$: CheerioAPI, _span: CheerioNode): AncestryBaseSlice {
  void _$;
  void _span;
  const fullHtml = c.body_html;
  const sizeFromTraits = c.traits.size;

  const hpRaw    = readSectionValue(fullHtml, 'Hit Points') ?? getField(c, 'Hit Points');
  const sizeRaw  = readSectionValue(fullHtml, 'Size')       ?? getField(c, 'Size');
  const speedRaw = readSectionValue(fullHtml, 'Speed')      ?? getField(c, 'Speed');
  const langsRaw = readSectionValue(fullHtml, 'Languages')  ?? getField(c, 'Languages');

  const boostsList = readSectionList(fullHtml, 'Attribute Boosts') ?? readSectionList(fullHtml, 'Ability Boosts');
  const flawsList  = readSectionList(fullHtml, 'Attribute Flaw')   ?? readSectionList(fullHtml, 'Attribute Flaws')
                  ?? readSectionList(fullHtml, 'Ability Flaw')     ?? readSectionList(fullHtml, 'Ability Flaws');
  const boostsRaw  = getField(c, 'Attribute Boosts', 'Ability Boosts');
  const flawsRaw   = getField(c, 'Attribute Flaw', 'Attribute Flaws', 'Ability Flaws', 'Ability Flaw');

  const size: string | null = sizeFromTraits ?? (sizeRaw !== null && SIZE_WORDS.has(sizeRaw) ? sizeRaw : sizeRaw);
  const speed = asInt(speedRaw);

  const attribute_boosts: string[] = boostsList !== null
    ? boostsList
    : boostsRaw !== null ? splitTopLevel(boostsRaw, ',') : [];
  const attribute_flaws: string[] = flawsList !== null
    ? flawsList
    : flawsRaw !== null ? splitTopLevel(flawsRaw, ',') : [];

  const languages = parseLanguages(langsRaw);
  const vision = findVision(c.sections);

  const granted: string[] = [];
  for (const s of c.sections) {
    if (/^(Clan Dagger|Granted|Heritage)/i.test(s.heading)) granted.push(s.heading);
  }

  const beliefs = c.sections.find((s) => /Beliefs/i.test(s.heading));
  const beliefsHtml = beliefs?.body_html ?? c.body_html;
  const popular_edicts   = findInlineMarker(beliefsHtml, 'Popular Edicts');
  const popular_anathema = findInlineMarker(beliefsHtml, 'Popular Anathema');

  const mechanics: AncestryMechanics = {
    hit_points: asInt(hpRaw),
    size,
    speed,
    attribute_boosts,
    attribute_flaws,
    languages,
    vision,
    granted,
  };

  return {
    url:             c.url,
    ancestry_id:       extractEntityId(c.url),
    name:            c.title.name,
    rarity:          c.traits.rarity,
    pfs:             c.title.pfs,
    legacy:          c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    traits:          c.traits.traits,
    trait_ids:       c.traits.trait_ids,
    source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:         c.sources,
    mechanics,
    popular_edicts,
    popular_anathema,
  };
}

/**
 * Discover heritages from h1>h2 sections. AON renders heritages as
 * `<h1 class="title">Heritages</h1>` followed by per-heritage
 * `<h2 class="title">Name</h2>VALUE`. Falls back to scanning all h2 sections
 * whose heading is a Title-Case single phrase when no h1 container is found.
 */
export function extractAncestryHeritages(c: CommonExtraction): AncestryHeritagesSlice {
  const out: Array<{ name: string; description: string }> = [];
  const heritageRe = /<h1[^>]+class="title"[^>]*>\s*Heritages\s*<\/h1>([\s\S]*?)(?=<h1[^>]+class="title"|$)/i;
  const m = heritageRe.exec(c.body_html);
  if (m !== null) {
    const inner = m[1] ?? '';
    const h2Re = /<h2[^>]+class="title"[^>]*>\s*([^<]+?)\s*<\/h2>\s*([\s\S]*?)(?=<h[123]|$)/gi;
    let h2m: RegExpExecArray | null;
    while ((h2m = h2Re.exec(inner)) !== null) {
      const name = (h2m[1] ?? '').trim();
      const description = htmlToText(h2m[2] ?? '').trim();
      if (name !== '' && description !== '') {
        out.push({ name, description });
      }
    }
  }
  return { heritages: out };
}

/**
 * Discover initial proficiencies + h2 ancestry features.
 *
 * Initial Proficiencies: `<h1 class="title">Initial Proficiencies</h1>` with
 * `<h2 class="title">Category</h2>VALUE` rows underneath (same layout as the
 * class extractor).
 *
 * Features: every h2 in the body that isn't claimed by mechanics (Hit Points,
 * Size, Speed, Languages, Attribute Boosts/Flaws) is captured as a feature
 * entry with its body_text as the description.
 */
export function extractAncestryFeatures(c: CommonExtraction): AncestryFeaturesSlice {
  const fullHtml = c.body_html;
  const initial_proficiencies: Record<string, string> = {};
  const initRe = /<h1[^>]+class="title"[^>]*>\s*Initial Proficiencies\s*<\/h1>([\s\S]*?)(?=<h1[^>]+class="title"|$)/i;
  const m = initRe.exec(fullHtml);
  if (m !== null) {
    const inner = m[1] ?? '';
    const h2Re = /<h2[^>]+class="title"[^>]*>\s*([^<]+?)\s*<\/h2>\s*([\s\S]*?)(?=<h[123]|$)/gi;
    let h2m: RegExpExecArray | null;
    while ((h2m = h2Re.exec(inner)) !== null) {
      const k = (h2m[1] ?? '').trim();
      const v = htmlToText(h2m[2] ?? '');
      if (k !== '' && v !== '' && !(k in initial_proficiencies)) initial_proficiencies[k] = v;
    }
  }

  const mechanicLabels = new Set([
    'hit points', 'size', 'speed', 'languages',
    'attribute boosts', 'attribute boost', 'ability boosts', 'ability boost',
    'attribute flaw', 'attribute flaws', 'ability flaw', 'ability flaws',
  ]);
  const profKeys = new Set(Object.keys(initial_proficiencies).map((k) => k.toLowerCase()));

  const features = parseGrantedFeatures(c.sections, {
    levels: [2],
    excludeLabels: [...mechanicLabels, ...profKeys],
  });

  return { initial_proficiencies, features };
}

/** Pass-through meta slice — currently just propagates sections from common. */
export function extractAncestryMeta(c: CommonExtraction): AncestryMetaSlice {
  return { sections: c.sections };
}

/**
 * Assemble the final AncestryOutput from per-slice results.
 *
 * Computes `raw_fields` by stripping every claimed field label plus every
 * initial-proficiencies category lifted by the features slice.
 */
export function finalizeAncestry(
  c:         CommonExtraction,
  base:      AncestryBaseSlice,
  heritages: AncestryHeritagesSlice,
  features:  AncestryFeaturesSlice,
  meta:      AncestryMetaSlice,
  $:         CheerioAPI,
): AncestryOutputFields {
  const claimedProfKeys = Object.keys(features.initial_proficiencies);
  const raw_fields = stripStructuredKeys(c.field_map, [
    ...CLAIMED_FIELD_LABELS,
    ...claimedProfKeys,
  ]);

  return {
    ...base,
    sections:              meta.sections,
    raw_fields,
    links:                 c.links,
    body_text:             c.body_text,
    body_html:             c.body_html,
    meta_description:      extractMetaDescription($),
    meta_keywords:         extractMetaKeywords($),
    heritages:             heritages.heritages,
    initial_proficiencies: features.initial_proficiencies,
    features:              features.features,
  } satisfies AncestryOutputFields;
}

/**
 * Extract a Pathfinder 2e ancestry record from an AON Ancestries.aspx page.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through
 * the decomposed ancestry extraction nodes.
 */
export function extractAncestry(c: CommonExtraction, $: CheerioAPI, span: CheerioNode): AncestryOutputFields {
  const base      = extractAncestryBase(c, $, span);
  const heritages = extractAncestryHeritages(c);
  const features  = extractAncestryFeatures(c);
  const meta      = extractAncestryMeta(c);
  return finalizeAncestry(c, base, heritages, features, meta, $);
}


// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

// Node: extract:ancestry-base
// Identity + mechanics + sources slice.

export type AncestryBaseOutput = 'success' | 'error';

export const ancestryBaseNode: NodeInterface<ScrapeState, AncestryBaseOutput, RipperServices> = {
  name:    'extract:ancestry-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: AncestryBaseOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'error' };

    const base = extractAncestryBase(c, $, target);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:ancestry-heritages
// Heritage sections discovered as h1>h2 block.

export type AncestryHeritagesOutput = 'success' | 'error';

export const ancestryHeritagesNode: NodeInterface<ScrapeState, AncestryHeritagesOutput, RipperServices> = {
  name:    'extract:ancestry-heritages',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: AncestryHeritagesOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const slice = extractAncestryHeritages(c);

    state.output = { ...state.output, ...slice };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:ancestry-features
// Initial proficiencies + h2 ancestry feature sections.

export type AncestryFeaturesOutput = 'success' | 'error';

export const ancestryFeaturesNode: NodeInterface<ScrapeState, AncestryFeaturesOutput, RipperServices> = {
  name:    'extract:ancestry-features',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: AncestryFeaturesOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const slice = extractAncestryFeatures(c);

    state.output = { ...state.output, ...slice };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: finalize:ancestry
// Assembles raw_fields + meta. Calls the Wave 5 finalizeAncestry helper which
// computes the raw_fields strip incorporating proficiency key claims.

export type FinalizeAncestryOutput = 'success';

export const finalizeAncestryNode: NodeInterface<ScrapeState, FinalizeAncestryOutput, RipperServices> = {
  name:    'finalize:ancestry',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeAncestryOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };

    const meta      = { sections: c.sections };
    const acc = (state.output ?? {}) as unknown as AncestryOutput;
    const assembled = finalizeAncestry(c, acc, acc, acc, meta, $);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

// ─── ConceptDecl export ───────────────────────────────────────────────────────

/**
 * Ancestry concept declaration for the AONPRD taxonomy.
 * Imported by `plugins/aonprd/taxonomy/aonprd.ts`.
 */
export const ancestryConcept: ConceptDecl<AncestryOutput> = {
  id:       'ancestry',
  parent:   'entity',
  urlPaths: ['ancestries'],
  capabilities: [
    ancestryBaseNode,
    ancestryHeritagesNode,
    ancestryFeaturesNode,
    finalizeAncestryNode,
  ],
  discriminator: { _type: 'ancestry' },
};
