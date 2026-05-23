// Curse concept — Phase 6.4 taxonomic extraction.
//
// Affliction pages (Curses.aspx) carry a statblock with Saving Throw, Onset,
// Maximum Duration, and Stage N progression markers. This concept delegates
// to the Wave 5 slice helpers in curse.ts for correctness; output is
// byte-equivalent to the Wave 5 baseline.
//
// Improvement vs Wave 5: no bespoke node-folder; capabilities are co-located
// in this file with inline contracts. Wave 6 M4 dropped the `entity_id` alias
// in favour of the concept-specific `curse_id`.
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

// ─── Inlined from Wave 5: curse.ts ──────────────────────────────────
// ─── Output type ──────────────────────────────────────────────────────────────

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
  _type:            'curse';
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
  _type:           'curse';
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
function locateAfflictionBlock(c: CommonExtraction): string {
  // Curses pages have the stage markers in body_html when there's an <hr />,
  // or in the head fragment when there isn't. Prefer body_html; fall back to
  // concatenating the head field-block when stages don't appear there.
  const body = c.body_html;
  if (/<b>\s*Stage\s+\d+\s*<\/b>/i.test(body)) return body;
  // Try reconstructing from c.fields by joining all `<b>label</b> value_html`
  // entries — but the head fragment is already captured separately. As a
  // fallback, just return body (parseStages will simply emit []).
  return body;
}

/**
 * Pull a labeled field value, preferring the header `field_map` and falling
 * back to a scan of the body HTML.
 */
function getCurseField(c: CommonExtraction, label: string): string | null {
  const headerVal = getField(c, label);
  if (headerVal !== null) return headerVal;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<b>\\s*${escaped}\\s*<\\/b>\\s*([\\s\\S]*?)(?=<b>|<br|<h[1-6]|<hr|$)`, 'i');
  const m = re.exec(c.body_html);
  if (m === null) return null;
  const text = htmlToText(m[1] ?? '');
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
  const re = /<b>\s*Stage\s+(\d+)\s*<\/b>/gi;
  const matches: Array<{ stage: number; index: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const stage = parseInt(m[1] ?? '0', 10);
    if (Number.isFinite(stage)) {
      matches.push({ stage, index: m.index, end: m.index + m[0].length });
    }
  }

  const stopRe = /<hr\s*\/?>|<h[1-6]\b/i;
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]!;
    const next = matches[i + 1];
    const tail = html.slice(cur.end);
    const stopMatch = stopRe.exec(tail);
    const stopIdx = stopMatch === null ? tail.length : stopMatch.index;
    const nextIdx = next !== undefined ? next.index - cur.end : tail.length;
    const end = Math.min(stopIdx, nextIdx);
    const segHtml = tail.slice(0, end).trim();

    const stage = stages[i];
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
export function extractCurseBase(c: CommonExtraction): CurseBaseSlice {
  return {
    _type:           'curse',
    url:             c.url,
    curse_id:        extractEntityId(c.url),
    name:            c.title.name,
    level:           c.title.level,
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

/** Extract affliction mechanics: saving throw, onset, maximum duration. */
export function extractCurseMechanics(c: CommonExtraction): CurseMechanicsSlice {
  const rawSt = getCurseField(c, 'Saving Throw');
  const parsed = parseSavingThrow(rawSt);
  const saving_throw: CurseSavingThrow | null = parsed === null
    ? null
    : { ...parsed, raw: rawSt! };
  return {
    saving_throw,
    onset:            getCurseField(c, 'Onset'),
    maximum_duration: getCurseField(c, 'Maximum Duration'),
  };
}

/** Extract Stage N progression markers from the body affliction block. */
export function extractCurseStages(c: CommonExtraction): CurseStagesSlice {
  return { stages: parseCurseStages(locateAfflictionBlock(c)) };
}

/** Extract meta-slice marker — sections/links/body/meta attach in finalize. */
export function extractCurseMeta(_c: CommonExtraction): CurseMetaSlice {
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
  c:         CommonExtraction,
  base:      CurseBaseSlice,
  mech:      CurseMechanicsSlice,
  stages:    CurseStagesSlice,
  _meta:     CurseMetaSlice,
  $:         CheerioAPI,
  _target:   CheerioNode,
): CurseOutput {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  return {
    _type:            'curse',
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
    sections:         c.sections,
    raw_fields,
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies CurseOutput;
}

/** Project a Curses.aspx page into a typed CurseOutput (direct-call wrapper). */
export function extractCurse(
  c:      CommonExtraction,
  $:      CheerioAPI,
  target: CheerioNode,
): CurseOutput {
  const base   = extractCurseBase(c);
  const mech   = extractCurseMechanics(c);
  const stages = extractCurseStages(c);
  const meta   = extractCurseMeta(c);
  return finalizeCurse(c, base, mech, stages, meta, $, target);
}


// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type CurseBaseOutput = 'success' | 'error';

export const curseBaseNode: NodeInterface<ScrapeState, CurseBaseOutput, RipperServices> = {
  name:    'extract:curse-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: CurseBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractCurseBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type CurseMechanicsOutput = 'success' | 'error';

export const curseMechanicsNode: NodeInterface<ScrapeState, CurseMechanicsOutput, RipperServices> = {
  name:    'extract:curse-mechanics',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: CurseMechanicsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const mech = extractCurseMechanics(c);

    state.output = { ...state.output, ...mech };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type CurseStagesOutput = 'success' | 'error';

export const curseStagesNode: NodeInterface<ScrapeState, CurseStagesOutput, RipperServices> = {
  name:    'extract:curse-stages',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: CurseStagesOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const stagesSlice = extractCurseStages(c);

    state.output = { ...state.output, ...stagesSlice };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeCurseOutput = 'success';

export const finalizeCurseNode: NodeInterface<ScrapeState, FinalizeCurseOutput, RipperServices> = {
  name:    'finalize:curse',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeCurseOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };

    // Pass a meta marker object inline — finalizeCurse ignores it (void _meta).
    const meta   = { __curse_meta_marked: true as const };
    const acc = (state.output ?? {}) as unknown as CurseOutput;
    const assembled = finalizeCurse(c, acc, acc, acc, meta, $, target);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

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
  discriminator: { _type: 'curse' },
};
