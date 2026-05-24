//
// the `legacy: true` flag already carries that signal from title extraction.
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

// ─── Inlined from Wave 5: weather-hazard.ts ──────────────────────────────────
// ─── Output type ──────────────────────────────────────────────────────────────

/** A single labelled mechanical effect of a weather hazard. */
export interface WeatherHazardEffect {
  /** Effect label parsed from the `<b>Label</b>` marker. */
  name: string;
  /** Prose body with HTML tags stripped. */
  body: string;
}

export interface WeatherHazardOutput {
  url:              string;
  /** Numeric AON WeatherHazards.aspx ID extracted from the URL query string. */
  weather_hazard_id: number | null;
  name:             string;
  level:            number | null;
  rarity:           Rarity;
  pfs:              PfsLegality | null;
  legacy:           boolean;
  alt_edition_url:  string | null;
  traits:           string[];
  trait_ids:        Record<string, number>;
  source:           { book: string | null; page: number | null; source_id: number | null };
  sources:          SourceRef[];

  // ─── Body ──────────────────────────────────────────────────────────────────
  /** Lead-in description prose preceding the first labelled effect. */
  description:      string | null;

  // ─── Effects ───────────────────────────────────────────────────────────────
  effects:          WeatherHazardEffect[];

  // ─── Bookkeeping ───────────────────────────────────────────────────────────
  sections:         Section[];
  raw_fields:       Record<string, string>;
  links:            LinkRef[];
  body_text:        string;
  body_html:        string;
  /** `<meta name="description">` content. */
  meta_description: string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords:    string | null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────────

/** Fields owned by `extract-weather-hazard-base`. */
export interface WeatherHazardBaseSlice {
  url:               string;
  weather_hazard_id: number | null;
  name:              string;
  level:             number | null;
  rarity:            Rarity;
  pfs:               PfsLegality | null;
  legacy:            boolean;
  alt_edition_url:   string | null;
  traits:            string[];
  trait_ids:         Record<string, number>;
  source:            WeatherHazardOutput['source'];
  sources:           SourceRef[];
}

/** Fields owned by `extract-weather-hazard-effects`. */
export interface WeatherHazardEffectsSlice {
  description: string | null;
  effects:     WeatherHazardEffect[];
}

/** Fields owned by `extract-weather-hazard-meta`. */
export interface WeatherHazardMetaSlice {
  /** Marker so `state.output` accumulates the slice. */
  __weather_hazard_meta_marked: true;
}

// ─── Effect parsing ───────────────────────────────────────────────────────────

/**
 * Parse `<b>Label</b> body` pairs into ordered effect entries.
 *
 * The first labelled paragraph and everything before it is treated as the
 * lead-in `description`; subsequent labelled paragraphs each become an
 * `WeatherHazardEffect`. Each effect body runs until the next `<b>` boundary,
 * the next heading, or end of fragment.
 */
function parseWeatherHazardEffects(html: string): { description: string | null; effects: WeatherHazardEffect[] } {
  // Locate every `<b>…</b>` label in the body.
  const labelRe = /<b>([\s\S]*?)<\/b>/gi;
  const labels: Array<{ name: string; index: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(html)) !== null) {
    const name = htmlToText(m[1] ?? '').replace(/[:?]$/, '').trim();
    if (name === '') continue;
    // Skip the `Source` label — the header source is structured separately.
    if (/^source$/i.test(name)) continue;
    labels.push({ name, index: m.index, end: m.index + m[0].length });
  }

  if (labels.length === 0) {
    const descText = htmlToText(html);
    return {
      description: descText === '' ? null : descText,
      effects:     [],
    };
  }

  // Description = everything before the first label.
  const descHtml = html.slice(0, labels[0]!.index);
  const descText = htmlToText(descHtml).trim();
  const description = descText === '' ? null : descText;

  const stopRe = /<h[1-6]\b/i;
  const effects: WeatherHazardEffect[] = [];
  for (let i = 0; i < labels.length; i++) {
    const cur  = labels[i]!;
    const next = labels[i + 1];
    const tail = html.slice(cur.end);
    const stopMatch = stopRe.exec(tail);
    const stopIdx = stopMatch === null ? tail.length : stopMatch.index;
    const nextIdx = next !== undefined ? (next.index - cur.end) : tail.length;
    const end = Math.min(stopIdx, nextIdx);
    const segHtml = tail.slice(0, end);
    const body = htmlToText(segHtml).replace(/^[\s;:.]+|[\s;]+$/g, '');
    if (body === '') continue;
    effects.push({ name: cur.name, body });
  }

  return { description, effects };
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract identity + header scalars for a weather-hazard page. */
export function extractWeatherHazardBase(c: CommonExtraction): WeatherHazardBaseSlice {
  return {
    url:               c.url,
    weather_hazard_id: extractEntityId(c.url),
    name:              c.title.name,
    level:             c.title.level,
    rarity:            c.traits.rarity,
    pfs:               c.title.pfs,
    legacy:            c.title.legacy,
    alt_edition_url:   c.title.alt_edition_url,
    traits:            c.traits.traits,
    trait_ids:         c.traits.trait_ids,
    source:            { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources:           c.sources,
  };
}

/** Extract the labelled effect paragraphs from the body. */
export function extractWeatherHazardEffects(c: CommonExtraction): WeatherHazardEffectsSlice {
  return parseWeatherHazardEffects(c.body_html);
}

/** Extract meta-slice marker — sections/links/body/meta attach in finalize. */
export function extractWeatherHazardMeta(_c: CommonExtraction): WeatherHazardMetaSlice {
  return { __weather_hazard_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

/** AON labels claimed by upstream weather-hazard slices. */
const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  // Hazard statblock head fields routinely present on weather pages.
  'Survival', 'Description', 'Requirements', 'Stealth',
];

export function finalizeWeatherHazard(
  c:         CommonExtraction,
  base:      WeatherHazardBaseSlice,
  effects:   WeatherHazardEffectsSlice,
  _meta:     WeatherHazardMetaSlice,
  $:         CheerioAPI,
  _target:   CheerioNode,
): WeatherHazardOutput {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  return {
    url:               base.url,
    weather_hazard_id: base.weather_hazard_id,
    name:              base.name,
    level:             base.level,
    rarity:            base.rarity,
    pfs:               base.pfs,
    legacy:            base.legacy,
    alt_edition_url:   base.alt_edition_url,
    traits:            base.traits,
    trait_ids:         base.trait_ids,
    source:            base.source,
    sources:           base.sources,
    description:       effects.description,
    effects:           effects.effects,
    sections:          c.sections,
    raw_fields,
    links:             c.links,
    body_text:         c.body_text,
    body_html:         c.body_html,
    meta_description:  extractMetaDescription($),
    meta_keywords:     extractMetaKeywords($),
  } satisfies WeatherHazardOutput;
}

/** Project a WeatherHazards.aspx page into a typed WeatherHazardOutput. */
export function extractWeatherHazard(
  c:      CommonExtraction,
  $:      CheerioAPI,
  target: CheerioNode,
): WeatherHazardOutput {
  const base    = extractWeatherHazardBase(c);
  const effects = extractWeatherHazardEffects(c);
  const meta    = extractWeatherHazardMeta(c);
  return finalizeWeatherHazard(c, base, effects, meta, $, target);
}

// Re-export output types so tests can import from here.
// ─── Helpers ─────────────────────────────────────────────────────────────────

/** AON labels claimed by weather-hazard capability nodes. */

// ─── Capability nodes ─────────────────────────────────────────────────────────

export type WeatherHazardBaseOutput = 'success' | 'error';

export const weatherHazardBaseNode: NodeInterface<ScrapeState, WeatherHazardBaseOutput, RipperServices> = {
  name:    'extract:weather-hazard-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: WeatherHazardBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base    = extractWeatherHazardBase(c);
    const effects = extractWeatherHazardEffects(c);

    state.output = state.output !== null
      ? { ...state.output, ...base, ...effects }
      : { ...base, ...effects };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeWeatherHazardOutput = 'success';

export const finalizeWeatherHazardNode: NodeInterface<ScrapeState, FinalizeWeatherHazardOutput, RipperServices> = {
  name:    'finalize:weather-hazard',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget', 'sections'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeWeatherHazardOutput }> {
    const c        = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $        = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target   = state.getMetadata<CheerioNode>('aonprdTarget');
    const sections = state.getMetadata<Section[]>('sections');
    if (c === undefined || $ === undefined || target === undefined || sections === undefined) {
      return { output: 'success' };
    }

    const base    = extractWeatherHazardBase(c);
    const effects = extractWeatherHazardEffects(c);

    const raw_fields       = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
    const links            = c.links;
    const meta_description = extractMetaDescription($);
    const meta_keywords    = extractMetaKeywords($);

    setConceptOutput(state, {
      url:               base.url,
      weather_hazard_id: base.weather_hazard_id,
      name:              base.name,
      level:             base.level,
      rarity:            base.rarity,
      pfs:               base.pfs,
      legacy:            base.legacy,
      alt_edition_url:   base.alt_edition_url,
      traits:            base.traits,
      trait_ids:         base.trait_ids,
      source:            base.source,
      sources:           base.sources,
      description:       effects.description,
      effects:           effects.effects,
      sections:          filterLegacySections(sections),
      raw_fields,
      links,
      body_text:         c.body_text,
      body_html:         c.body_html,
      meta_description,
      meta_keywords,
    } satisfies WeatherHazardOutput);

    return { output: 'success' };
  },
};

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const weatherHazardConcept: ConceptDecl<WeatherHazardOutput> = {
  id:       'weather-hazard',
  parent:   'entity',
  urlPaths: ['weatherhazards'],
  capabilities: [
    weatherHazardBaseNode,
    finalizeWeatherHazardNode,
  ],
};
