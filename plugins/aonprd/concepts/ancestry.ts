//
// Four decomposed slices: base (identity + mechanics + popular edicts/anathema),
// heritages (h2 heritage sections), features (initial proficiencies + feature
// sections), and finalize (raw_fields + meta). Chrome filtering: no legacy
// section filtering is applied here (ancestry pages don't typically carry the
// legacy-content-warning heading).
//
// partial extraction and incremental composition in the taxonomy pipeline.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { ConceptDecl } from '../taxonomy.js';
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

export interface AncestryOutput {
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
  const regex = new RegExp(`<h[23][^>]+class="title"[^>]*>\\s*${escaped}\\s*<\\/h[23]>\\s*([\\s\\S]*?)(?=<h[23]|$)`, 'i');
  const match = regex.exec(html);
  if (match === null) return null;
  return htmlToText(match[1] ?? '');
}

/**
 * Read a section body as a list — splits on `<br />` before stripping HTML so
 * each line element becomes its own entry. Used for Attribute Boosts/Flaws on
 * modern AON ancestry pages where boosts are listed one per `<br />`.
 */
function readSectionList(html: string, label: string): string[] | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`<h[23][^>]+class="title"[^>]*>\\s*${escaped}\\s*<\\/h[23]>\\s*([\\s\\S]*?)(?=<h[23]|$)`, 'i');
  const match = regex.exec(html);
  if (match === null) return null;
  return (match[1] ?? '')
    .split(/<br\s*\/?>/i)
    .map((chunk) => htmlToText(chunk))
    .filter((trimmed) => trimmed !== '');
}

/** Find inline `<b>Marker</b> VALUE` followed by next-bold or heading boundary. */
function findInlineMarker(html: string, label: string): string | null {
  const regex = new RegExp(`<b>\\s*${label}\\s*<\\/b>\\s*([\\s\\S]*?)(?=<b>|<h[1-6]|<hr|$)`, 'i');
  const match = regex.exec(html);
  return match === null ? null : htmlToText(match[1] ?? '');
}

function parseLanguages(value: string | null): AncestryMechanics['languages'] {
  if (value === null) return { fixed: [], bonus_choice: [], raw: null };
  const parts = splitTopLevel(value, ',');
  const fixed: string[] = [];
  const bonus_choice: string[] = [];
  for (const part of parts) {
    if (/intelligence|bonus|additional|number you can speak|chose/i.test(part)) {
      bonus_choice.push(part.trim());
    } else if (part.trim() !== '') {
      fixed.push(part.trim());
    }
  }
  return { fixed, bonus_choice, raw: value };
}

function findVision(sections: ReadonlyArray<Section>): string | null {
  for (const section of sections) {
    const lcLabel = section.heading.toLowerCase();
    if (lcLabel.includes('darkvision') || lcLabel.includes('low-light vision') || lcLabel.includes('vision')) {
      return section.heading;
    }
  }
  return null;
}

// ─── Slice extraction ─────────────────────────────────────────────────────────

/** Extract identity + mechanics + popular edicts/anathema. */
export function extractAncestryBase(common: CommonExtraction, _root: CheerioAPI, _span: CheerioNode): AncestryBaseSlice {
  void _root;
  void _span;
  const fullHtml = common.body_html;
  const sizeFromTraits = common.traits.size;

  const hpRaw    = readSectionValue(fullHtml, 'Hit Points') ?? getField(common, 'Hit Points');
  const sizeRaw  = readSectionValue(fullHtml, 'Size')       ?? getField(common, 'Size');
  const speedRaw = readSectionValue(fullHtml, 'Speed')      ?? getField(common, 'Speed');
  const langsRaw = readSectionValue(fullHtml, 'Languages')  ?? getField(common, 'Languages');

  const boostsList = readSectionList(fullHtml, 'Attribute Boosts') ?? readSectionList(fullHtml, 'Ability Boosts');
  const flawsList  = readSectionList(fullHtml, 'Attribute Flaw')   ?? readSectionList(fullHtml, 'Attribute Flaws')
                  ?? readSectionList(fullHtml, 'Ability Flaw')     ?? readSectionList(fullHtml, 'Ability Flaws');
  const boostsRaw  = getField(common, 'Attribute Boosts', 'Ability Boosts');
  const flawsRaw   = getField(common, 'Attribute Flaw', 'Attribute Flaws', 'Ability Flaws', 'Ability Flaw');

  const size: string | null = sizeFromTraits ?? (sizeRaw !== null && SIZE_WORDS.has(sizeRaw) ? sizeRaw : sizeRaw);
  const speed = asInt(speedRaw);

  const attribute_boosts: string[] = boostsList !== null
    ? boostsList
    : boostsRaw !== null ? splitTopLevel(boostsRaw, ',') : [];
  const attribute_flaws: string[] = flawsList !== null
    ? flawsList
    : flawsRaw !== null ? splitTopLevel(flawsRaw, ',') : [];

  const languages = parseLanguages(langsRaw);
  const vision = findVision(common.sections);

  const granted: string[] = [];
  for (const section of common.sections) {
    if (/^(Clan Dagger|Granted|Heritage)/i.test(section.heading)) granted.push(section.heading);
  }

  const beliefs = common.sections.find((section) => /Beliefs/i.test(section.heading));
  const beliefsHtml = beliefs?.body_html ?? common.body_html;
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
    url:             common.url,
    ancestry_id:       extractEntityId(common.url),
    name:            common.title.name,
    rarity:          common.traits.rarity,
    pfs:             common.title.pfs,
    legacy:          common.title.legacy,
    alt_edition_url: common.title.alt_edition_url,
    traits:          common.traits.traits,
    trait_ids:       common.traits.trait_ids,
    source:          { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:         common.sources,
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
export function extractAncestryHeritages(common: CommonExtraction): AncestryHeritagesSlice {
  const out: Array<{ name: string; description: string }> = [];
  const heritageRe = /<h1[^>]+class="title"[^>]*>\s*Heritages\s*<\/h1>([\s\S]*?)(?=<h1[^>]+class="title"|$)/i;
  const match = heritageRe.exec(common.body_html);
  if (match !== null) {
    const inner = match[1] ?? '';
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
export function extractAncestryFeatures(common: CommonExtraction): AncestryFeaturesSlice {
  const fullHtml = common.body_html;
  const initial_proficiencies: Record<string, string> = {};
  const initRe = /<h1[^>]+class="title"[^>]*>\s*Initial Proficiencies\s*<\/h1>([\s\S]*?)(?=<h1[^>]+class="title"|$)/i;
  const match = initRe.exec(fullHtml);
  if (match !== null) {
    const inner = match[1] ?? '';
    const h2Re = /<h2[^>]+class="title"[^>]*>\s*([^<]+?)\s*<\/h2>\s*([\s\S]*?)(?=<h[123]|$)/gi;
    let h2m: RegExpExecArray | null;
    while ((h2m = h2Re.exec(inner)) !== null) {
      const key = (h2m[1] ?? '').trim();
      const value = htmlToText(h2m[2] ?? '');
      if (key !== '' && value !== '' && !(key in initial_proficiencies)) initial_proficiencies[key] = value;
    }
  }

  const mechanicLabels = new Set([
    'hit points', 'size', 'speed', 'languages',
    'attribute boosts', 'attribute boost', 'ability boosts', 'ability boost',
    'attribute flaw', 'attribute flaws', 'ability flaw', 'ability flaws',
  ]);
  const profKeys = new Set(Object.keys(initial_proficiencies).map((key) => key.toLowerCase()));

  const features = parseGrantedFeatures(common.sections, {
    levels: [2],
    excludeLabels: [...mechanicLabels, ...profKeys],
  });

  return { initial_proficiencies, features };
}

/** Pass-through meta slice — currently just propagates sections from common. */
export function extractAncestryMeta(common: CommonExtraction): AncestryMetaSlice {
  return { sections: common.sections };
}

/**
 * Assemble the final AncestryOutput from per-slice results.
 *
 * Computes `raw_fields` by stripping every claimed field label plus every
 * initial-proficiencies category lifted by the features slice.
 */
export function finalizeAncestry(
  common:    CommonExtraction,
  base:      AncestryBaseSlice,
  heritages: AncestryHeritagesSlice,
  features:  AncestryFeaturesSlice,
  meta:      AncestryMetaSlice,
  root:      CheerioAPI,
): AncestryOutput {
  const claimedProfKeys = Object.keys(features.initial_proficiencies);
  const raw_fields = stripStructuredKeys(common.field_map, [
    ...CLAIMED_FIELD_LABELS,
    ...claimedProfKeys,
  ]);

  return {
    ...base,
    sections:              meta.sections,
    raw_fields,
    links:                 common.links,
    body_text:             common.body_text,
    body_html:             common.body_html,
    meta_description:      extractMetaDescription(root),
    meta_keywords:         extractMetaKeywords(root),
    heritages:             heritages.heritages,
    initial_proficiencies: features.initial_proficiencies,
    features:              features.features,
  } satisfies AncestryOutput;
}

/**
 * Extract a Pathfinder 2e ancestry record from an AON Ancestries.aspx page.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through
 * the decomposed ancestry extraction nodes.
 */
export function extractAncestry(common: CommonExtraction, root: CheerioAPI, span: CheerioNode): AncestryOutput {
  const base      = extractAncestryBase(common, root, span);
  const heritages = extractAncestryHeritages(common);
  const features  = extractAncestryFeatures(common);
  const meta      = extractAncestryMeta(common);
  return finalizeAncestry(common, base, heritages, features, meta, root);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

// Node: extract:ancestry-base
// Identity + mechanics + sources slice.

export type AncestryBaseOutput = 'success' | 'error';

class AncestryBaseNode extends ScalarNode<ScrapeState, AncestryBaseOutput> {
  public readonly name = 'extract:ancestry-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<AncestryBaseOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('error');

    const base = extractAncestryBase(common, root, target);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const ancestryBaseNode = new AncestryBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:ancestry-heritages
// Heritage sections discovered as h1>h2 block.

export type AncestryHeritagesOutput = 'success' | 'error';

class AncestryHeritagesNode extends ScalarNode<ScrapeState, AncestryHeritagesOutput> {
  public readonly name = 'extract:ancestry-heritages';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<AncestryHeritagesOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const slice = extractAncestryHeritages(common);

    state.output = { ...state.output, ...slice };

    return NodeOutputBuilder.of('success');
  }
}

export const ancestryHeritagesNode = new AncestryHeritagesNode();

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:ancestry-features
// Initial proficiencies + h2 ancestry feature sections.

export type AncestryFeaturesOutput = 'success' | 'error';

class AncestryFeaturesNode extends ScalarNode<ScrapeState, AncestryFeaturesOutput> {
  public readonly name = 'extract:ancestry-features';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<AncestryFeaturesOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const slice = extractAncestryFeatures(common);

    state.output = { ...state.output, ...slice };

    return NodeOutputBuilder.of('success');
  }
}

export const ancestryFeaturesNode = new AncestryFeaturesNode();

// ─────────────────────────────────────────────────────────────────────────────

// Node: finalize:ancestry
// Assembles raw_fields + meta. Computes the raw_fields strip incorporating
// proficiency key claims.

export type FinalizeAncestryOutput = 'success';

class FinalizeAncestryNode extends ScalarNode<ScrapeState, FinalizeAncestryOutput> {
  public readonly name = 'finalize:ancestry';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeAncestryOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('success');

    const meta      = { sections: common.sections };
    const acc = (state.output ?? {}) as unknown as AncestryOutput;
    const assembled = finalizeAncestry(common, acc, acc, acc, meta, root);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeAncestryNode = new FinalizeAncestryNode();

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
};
