// Action extractor for AON (Archives of Nethys, 2e.aonprd.com).
// Projects header labels (Trigger / Frequency / Requirements / Cost) and
// parses the four-tier degrees-of-success block (`<b>Critical Success</b>`,
// `<b>Success</b>`, `<b>Failure</b>`, `<b>Critical Failure</b>`) from the
// post-`<hr />` effect prose into structured outcomes.
import type { CheerioAPI } from 'cheerio';
import {
  type CommonExtraction, type CheerioNode, type ActionCost, type LinkRef,
  type Rarity, type SourceRef,
  getField, htmlToText, harvestLinks,
  extractEntityId, extractMetaDescription, extractMetaKeywords,
} from './common.js';

// ─── Output shape ─────────────────────────────────────────────────────────────

export interface ActionOutput {
  _type: 'action';
  url: string;
  /** Numeric AON ID extracted from the URL query string. */
  action_id: number | null;
  name: string;
  rarity: Rarity;
  action_cost: ActionCost | null;
  traits: string[];
  /** Trait AON IDs keyed by trait name. */
  trait_ids: Record<string, number>;
  source: { book: string | null; page: number | null; source_id: number | null };
  /** All source refs on the page (header + body footnotes). */
  sources: SourceRef[];
  legacy: boolean;
  alt_edition_url: string | null;
  trigger: string | null;
  frequency: string | null;
  requirements: string | null;
  cost: string | null;
  effect_html: string;
  effect_text: string;
  outcomes: {
    critical_success: string | null;
    success: string | null;
    failure: string | null;
    critical_failure: string | null;
  };
  raw_fields: Record<string, string>;
  links: LinkRef[];
  /** `<meta name="description">` content. */
  meta_description: string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DASH_RE = /^(?:—|–|-|&mdash;|&ndash;)$/;

function dashToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '' || DASH_RE.test(trimmed)) return null;
  return trimmed;
}

interface OutcomeMap {
  critical_success: string | null;
  success: string | null;
  failure: string | null;
  critical_failure: string | null;
}

const OUTCOME_KEYS: ReadonlyMap<string, keyof OutcomeMap> = new Map<string, keyof OutcomeMap>([
  ['critical success', 'critical_success'],
  ['success', 'success'],
  ['failure', 'failure'],
  ['critical failure', 'critical_failure'],
]);

/**
 * Walk `<b>Tier</b> body … <br /> <b>Tier</b> …` patterns out of the effect HTML.
 * Each tier body runs until the next tier marker or an `<hr />`.
 */
function parseOutcomes(bodyHtml: string): OutcomeMap {
  const out: OutcomeMap = {
    critical_success: null,
    success: null,
    failure: null,
    critical_failure: null,
  };
  // Stop body harvest at the first `<hr />` (separator from continued prose).
  const hrIdx = /<hr\s*\/?>/i.exec(bodyHtml);
  const scope = hrIdx === null ? bodyHtml : bodyHtml.slice(0, hrIdx.index);

  // Find every `<b>(Critical Success|Success|Failure|Critical Failure)</b>` marker.
  const markerRe = /<b>\s*(Critical Success|Critical Failure|Success|Failure)\s*<\/b>/gi;
  type Marker = { key: keyof OutcomeMap; start: number; end: number };
  const markers: Marker[] = [];
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(scope)) !== null) {
    const label = (m[1] ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    const key = OUTCOME_KEYS.get(label);
    if (key === undefined) continue;
    markers.push({ key, start: m.index, end: m.index + m[0].length });
  }
  for (let i = 0; i < markers.length; i++) {
    const cur = markers[i]!;
    const next = markers[i + 1];
    const sliceEnd = next === undefined ? scope.length : next.start;
    const value = scope.slice(cur.end, sliceEnd);
    const text = htmlToText(value);
    if (text !== '') out[cur.key] = text;
  }
  return out;
}

/** Build effect prose, stripping the outcome markers we already projected. */
function buildEffect(bodyHtml: string): { html: string; text: string } {
  // Cap at first `<h2>` subsection or `<hr />`.
  const subIdx = /<h2\s+class="title"/i.exec(bodyHtml);
  const before = subIdx === null ? bodyHtml : bodyHtml.slice(0, subIdx.index);
  return { html: before.trim(), text: htmlToText(before) };
}

// ─── Public extractor ─────────────────────────────────────────────────────────

/** Project a CommonExtraction of an Actions.aspx page into a typed ActionOutput. */
export function extractAction(c: CommonExtraction, $: CheerioAPI, span: CheerioNode): ActionOutput {
  void span;
  const effect = buildEffect(c.body_html);
  const outcomes = parseOutcomes(c.body_html);

  return {
    _type: 'action',
    url: c.url,
    action_id: extractEntityId(c.url),
    name: c.title.name,
    rarity: c.traits.rarity,
    action_cost: c.title.action_cost,
    traits: c.traits.traits,
    trait_ids: c.traits.trait_ids,
    source: { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
    sources: c.sources,
    legacy: c.title.legacy,
    alt_edition_url: c.title.alt_edition_url,
    trigger:      dashToNull(getField(c, 'Trigger')),
    frequency:    dashToNull(getField(c, 'Frequency')),
    requirements: dashToNull(getField(c, 'Requirements')),
    cost:         dashToNull(getField(c, 'Cost')),
    effect_html: effect.html,
    effect_text: effect.text,
    outcomes,
    raw_fields: { ...c.field_map },
    links: harvestLinks(c.body_html).length > 0 ? harvestLinks(c.body_html) : c.links,
    meta_description: extractMetaDescription($),
    meta_keywords: extractMetaKeywords($),
  };
}
