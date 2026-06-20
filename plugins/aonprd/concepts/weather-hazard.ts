//
// the `legacy: true` flag already carries that signal from title extraction.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
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
  let match: RegExpExecArray | null;
  while ((match = labelRe.exec(html)) !== null) {
    const name = htmlToText(match[1] ?? '').replace(/[:?]$/, '').trim();
    if (name === '') continue;
    // Skip the `Source` label — the header source is structured separately.
    if (/^source$/i.test(name)) continue;
    labels.push({ name, index: match.index, end: match.index + match[0].length });
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
  for (let index = 0; index < labels.length; index++) {
    const cur  = labels[index]!;
    const next = labels[index + 1];
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
export function extractWeatherHazardBase(common: CommonExtraction): WeatherHazardBaseSlice {
  return {
    url:               common.url,
    weather_hazard_id: extractEntityId(common.url),
    name:              common.title.name,
    level:             common.title.level,
    rarity:            common.traits.rarity,
    pfs:               common.title.pfs,
    legacy:            common.title.legacy,
    alt_edition_url:   common.title.alt_edition_url,
    traits:            common.traits.traits,
    trait_ids:         common.traits.trait_ids,
    source:            { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:           common.sources,
  };
}

/** Extract the labelled effect paragraphs from the body. */
export function extractWeatherHazardEffects(common: CommonExtraction): WeatherHazardEffectsSlice {
  return parseWeatherHazardEffects(common.body_html);
}

/** Extract meta-slice marker — sections/links/body/meta attach in finalize. */
export function extractWeatherHazardMeta(_common: CommonExtraction): WeatherHazardMetaSlice {
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
  common:    CommonExtraction,
  base:      WeatherHazardBaseSlice,
  effects:   WeatherHazardEffectsSlice,
  _meta:     WeatherHazardMetaSlice,
  root:      CheerioAPI,
  _target:   CheerioNode,
): WeatherHazardOutput {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
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
    sections:          common.sections,
    raw_fields,
    links:             common.links,
    body_text:         common.body_text,
    body_html:         common.body_html,
    meta_description:  extractMetaDescription(root),
    meta_keywords:     extractMetaKeywords(root),
  } satisfies WeatherHazardOutput;
}

/** Project a WeatherHazards.aspx page into a typed WeatherHazardOutput. */
export function extractWeatherHazard(
  common: CommonExtraction,
  root:   CheerioAPI,
  target: CheerioNode,
): WeatherHazardOutput {
  const base    = extractWeatherHazardBase(common);
  const effects = extractWeatherHazardEffects(common);
  const meta    = extractWeatherHazardMeta(common);
  return finalizeWeatherHazard(common, base, effects, meta, root, target);
}

// Re-export output types so tests can import from here.
// ─── Helpers ─────────────────────────────────────────────────────────────────

/** AON labels claimed by weather-hazard capability nodes. */

// ─── Capability nodes ─────────────────────────────────────────────────────────

export type WeatherHazardBaseOutput = 'success' | 'error';

class WeatherHazardBaseNode extends ScalarNode<ScrapeState, WeatherHazardBaseOutput> {
  public readonly name = 'extract:weather-hazard-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<WeatherHazardBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base    = extractWeatherHazardBase(common);
    const effects = extractWeatherHazardEffects(common);

    state.output = state.output !== null
      ? { ...state.output, ...base, ...effects }
      : { ...base, ...effects };

    return NodeOutputBuilder.of('success');
  }
}

export const weatherHazardBaseNode = new WeatherHazardBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeWeatherHazardOutput = 'success';

class FinalizeWeatherHazardNode extends ScalarNode<ScrapeState, FinalizeWeatherHazardOutput> {
  public readonly name = 'finalize:weather-hazard';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeWeatherHazardOutput>> {
    const common   = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root     = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target   = state.getMetadata<CheerioNode>('aonprdTarget');
    const sections = state.getMetadata<Section[]>('sections');
    if (common === undefined || root === undefined || target === undefined || sections === undefined) {
      return NodeOutputBuilder.of('success');
    }

    const base    = extractWeatherHazardBase(common);
    const effects = extractWeatherHazardEffects(common);

    const raw_fields       = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
    const links            = common.links;
    const meta_description = extractMetaDescription(root);
    const meta_keywords    = extractMetaKeywords(root);

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
      body_text:         common.body_text,
      body_html:         common.body_html,
      meta_description,
      meta_keywords,
    } satisfies WeatherHazardOutput);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeWeatherHazardNode = new FinalizeWeatherHazardNode();

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
