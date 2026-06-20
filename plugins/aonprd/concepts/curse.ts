//
// Affliction pages (Curses.aspx) carry a statblock with Saving Throw, Onset,
// Maximum Duration, and Stage N progression markers. This concept delegates
// Helpers are inlined with inline contracts. The `entity_id` alias was
// dropped in favour of the concept-specific `curse_id`.
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
  type LinkRef,
  type Rarity,
  type PfsLegality,
  type Section,
  type SourceRef,
  getField,
  htmlToText,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';
import { parseSavingThrow } from '../capabilities/savingThrow.js';
import { parseAfflictionStages } from '../capabilities/afflictionStages.js';

// ─── Output type ─────────────────────────────────────────────────────────────

/** A single stage of a curse progression. */
export interface CurseStage {
  /** Stage number parsed from the `<b>Stage N</b>` marker. */
  stage:     number;
  /** Prose body with HTML tags stripped. */
  body_text: string;
  /** Verbatim HTML between this stage marker and the next. */
  body_html: string;
  /** Optional `(duration)` parenthetical such as "1 day", "1 round". */
  duration:  string | null;
}

/** Saving Throw breakdown — DC + save name + basic flag. */
export interface CurseSavingThrow {
  /** DC value when present (`DC 28 Will` → 28). */
  dc:    number | null;
  /** Save name when present (`Will`, `Fortitude`, `Reflex`). */
  save:  string | null;
  /** True when the throw is prefixed with `basic`. */
  basic: boolean;
  /** Raw value verbatim. */
  raw:   string;
}

export interface CurseOutput {
  url:              string;
  /** Numeric AON Curses.aspx ID extracted from the URL query string. */
  curse_id:         number | null;
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

  // ─── Mechanics ─────────────────────────────────────────────────────────────
  saving_throw:     CurseSavingThrow | null;
  onset:            string | null;
  maximum_duration: string | null;

  // ─── Stages ────────────────────────────────────────────────────────────────
  stages:           CurseStage[];

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

/** Fields owned by `extract-curse-base`. */
export interface CurseBaseSlice {
  url:             string;
  curse_id:        number | null;
  name:            string;
  level:           number | null;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          CurseOutput['source'];
  sources:         SourceRef[];
}

/** Fields owned by `extract-curse-mechanics`. */
export interface CurseMechanicsSlice {
  saving_throw:     CurseSavingThrow | null;
  onset:            string | null;
  maximum_duration: string | null;
}

/** Fields owned by `extract-curse-stages`. */
export interface CurseStagesSlice {
  stages: CurseStage[];
}

/** Fields owned by `extract-curse-meta`. */
export interface CurseMetaSlice {
  /** Marker so `state.output` accumulates the slice. */
  __curse_meta_marked: true;
}

// ─── Affliction helpers (curse-local, parallel to spell.ts) ───────────────────

/**
 * Locate the affliction statblock region. Returns the section of body_html
 * containing the stage markers, or the whole body when no specific affliction
 * header is found.
 */
function locateAfflictionBlock(common: CommonExtraction): string {
  // Curses pages have the stage markers in body_html when there's an <hr />,
  // or in the head fragment when there isn't. Prefer body_html; fall back to
  // concatenating the head field-block when stages don't appear there.
  const body = common.body_html;
  if (/<b>\s*Stage\s+\d+\s*<\/b>/i.test(body)) return body;
  // Try reconstructing from common.fields by joining all `<b>label</b> value_html`
  // entries — but the head fragment is already captured separately. As a
  // fallback, just return body (parseStages will simply emit []).
  return body;
}

/**
 * Pull a labeled field value, preferring the header `field_map` and falling
 * back to a scan of the body HTML.
 */
function getCurseField(common: CommonExtraction, label: string): string | null {
  const headerVal = getField(common, label);
  if (headerVal !== null) return headerVal;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`<b>\\s*${escaped}\\s*<\\/b>\\s*([\\s\\S]*?)(?=<b>|<br|<h[1-6]|<hr|$)`, 'i');
  const match = regex.exec(common.body_html);
  if (match === null) return null;
  const text = htmlToText(match[1] ?? '');
  return text === '' ? null : text;
}

/**
 * Parse curse stages from affliction block HTML using shared capability.
 * Converts AfflictionStage (body_text, duration) to CurseStage (body_text, body_html, duration).
 */
function parseCurseStages(html: string): CurseStage[] {
  const stages = parseAfflictionStages(html);
  const curseStages: CurseStage[] = [];

  // Rebuild HTML segments for each stage to populate body_html.
  const stageRe = /<b>\s*Stage\s+(\d+)\s*<\/b>/gi;
  const matches: Array<{ stage: number; index: number; end: number }> = [];
  let stageMatch: RegExpExecArray | null;
  while ((stageMatch = stageRe.exec(html)) !== null) {
    const stage = parseInt(stageMatch[1] ?? '0', 10);
    if (Number.isFinite(stage)) {
      matches.push({ stage, index: stageMatch.index, end: stageMatch.index + stageMatch[0].length });
    }
  }

  const stopRe = /<hr\s*\/?>|<h[1-6]\b/i;
  for (let index = 0; index < matches.length; index++) {
    const cur = matches[index]!;
    const next = matches[index + 1];
    const tail = html.slice(cur.end);
    const stopMatch = stopRe.exec(tail);
    const stopIdx = stopMatch === null ? tail.length : stopMatch.index;
    const nextIdx = next !== undefined ? next.index - cur.end : tail.length;
    const end = Math.min(stopIdx, nextIdx);
    const segHtml = tail.slice(0, end).trim();

    const stage = stages[index];
    if (stage !== undefined) {
      curseStages.push({
        stage: stage.stage,
        body_text: stage.body_text,
        body_html: segHtml,
        duration: stage.duration,
      });
    }
  }
  return curseStages;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract identity + header scalars for a curse page. */
export function extractCurseBase(common: CommonExtraction): CurseBaseSlice {
  return {
    url:             common.url,
    curse_id:        extractEntityId(common.url),
    name:            common.title.name,
    level:           common.title.level,
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

/** Extract affliction mechanics: saving throw, onset, maximum duration. */
export function extractCurseMechanics(common: CommonExtraction): CurseMechanicsSlice {
  const rawSt = getCurseField(common, 'Saving Throw');
  const parsed = parseSavingThrow(rawSt);
  const saving_throw: CurseSavingThrow | null = parsed === null
    ? null
    : { ...parsed, raw: rawSt! };
  return {
    saving_throw,
    onset:            getCurseField(common, 'Onset'),
    maximum_duration: getCurseField(common, 'Maximum Duration'),
  };
}

/** Extract Stage N progression markers from the body affliction block. */
export function extractCurseStages(common: CommonExtraction): CurseStagesSlice {
  return { stages: parseCurseStages(locateAfflictionBlock(common)) };
}

/** Extract meta-slice marker — sections/links/body/meta attach in finalize. */
export function extractCurseMeta(_common: CommonExtraction): CurseMetaSlice {
  return { __curse_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

/** AON labels claimed by upstream curse slices. */
const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Saving Throw', 'Onset', 'Maximum Duration',
  // Inline ability-card labels inside curse bodies.
  'Effect',
];

export function finalizeCurse(
  common:    CommonExtraction,
  base:      CurseBaseSlice,
  mech:      CurseMechanicsSlice,
  stages:    CurseStagesSlice,
  _meta:     CurseMetaSlice,
  root:      CheerioAPI,
  _target:   CheerioNode,
): CurseOutput {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
  return {
    url:              base.url,
    curse_id:         base.curse_id,
    name:             base.name,
    level:            base.level,
    rarity:           base.rarity,
    pfs:              base.pfs,
    legacy:           base.legacy,
    alt_edition_url:  base.alt_edition_url,
    traits:           base.traits,
    trait_ids:        base.trait_ids,
    source:           base.source,
    sources:          base.sources,
    saving_throw:     mech.saving_throw,
    onset:            mech.onset,
    maximum_duration: mech.maximum_duration,
    stages:           stages.stages,
    sections:         common.sections,
    raw_fields,
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies CurseOutput;
}

/** Project a Curses.aspx page into a typed CurseOutput (direct-call wrapper). */
export function extractCurse(
  common:  CommonExtraction,
  root:    CheerioAPI,
  target:  CheerioNode,
): CurseOutput {
  const base   = extractCurseBase(common);
  const mech   = extractCurseMechanics(common);
  const stages = extractCurseStages(common);
  const meta   = extractCurseMeta(common);
  return finalizeCurse(common, base, mech, stages, meta, root, target);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type CurseBaseOutput = 'success' | 'error';

class CurseBaseNodeImpl extends ScalarNode<ScrapeState, CurseBaseOutput> {
  public readonly name    = 'extract:curse-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<CurseBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractCurseBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}
export const curseBaseNode = new CurseBaseNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type CurseMechanicsOutput = 'success' | 'error';

class CurseMechanicsNodeImpl extends ScalarNode<ScrapeState, CurseMechanicsOutput> {
  public readonly name    = 'extract:curse-mechanics';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<CurseMechanicsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const mech = extractCurseMechanics(common);

    state.output = { ...state.output, ...mech };

    return NodeOutputBuilder.of('success');
  }
}
export const curseMechanicsNode = new CurseMechanicsNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type CurseStagesOutput = 'success' | 'error';

class CurseStagesNodeImpl extends ScalarNode<ScrapeState, CurseStagesOutput> {
  public readonly name    = 'extract:curse-stages';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<CurseStagesOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const stagesSlice = extractCurseStages(common);

    state.output = { ...state.output, ...stagesSlice };

    return NodeOutputBuilder.of('success');
  }
}
export const curseStagesNode = new CurseStagesNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeCurseOutput = 'success';

class FinalizeCurseNodeImpl extends ScalarNode<ScrapeState, FinalizeCurseOutput> {
  public readonly name    = 'finalize:curse';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeCurseOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('success');

    // Pass a meta marker object inline — finalizeCurse ignores it (void _meta).
    const meta   = { __curse_meta_marked: true as const };
    const acc = (state.output ?? {}) as unknown as CurseOutput;
    const assembled = finalizeCurse(common, acc, acc, acc, meta, root, target);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}
export const finalizeCurseNode = new FinalizeCurseNodeImpl();

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const curseConcept: ConceptDecl<CurseOutput> = {
  id:       'curse',
  parent:   'entity',
  urlPaths: ['curses'],
  capabilities: [
    curseBaseNode,
    curseMechanicsNode,
    curseStagesNode,
    finalizeCurseNode,
  ],
};
