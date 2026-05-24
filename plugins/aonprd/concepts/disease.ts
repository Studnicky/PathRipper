// Disease concept — Phase 6.4 taxonomic extraction.
//
// Affliction pages (Diseases.aspx) carry a statblock with Saving Throw, Onset,
// Maximum Duration, and Stage N progression markers. This concept delegates
// to the Wave 5 slice helpers in disease.ts for correctness; output is
// byte-equivalent to the Wave 5 baseline.
//
// Improvement vs Wave 5: no bespoke node-folder; capabilities are co-located
// in this file with inline contracts. Wave 6 M4 dropped the `entity_id` alias
// in favour of the concept-specific `disease_id`.
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

// ─── Inlined from Wave 5: disease.ts ──────────────────────────────────
// ─── Output type ──────────────────────────────────────────────────────────────

/** A single stage of a disease progression. */
export interface DiseaseStage {
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
export interface DiseaseSavingThrow {
  /** DC value when present (`DC 22 Fortitude` → 22). */
  dc:    number | null;
  /** Save name when present (`Fortitude`, `Will`, `Reflex`). */
  save:  string | null;
  /** True when the throw is prefixed with `basic`. */
  basic: boolean;
  /** Raw value verbatim. */
  raw:   string;
}

export interface DiseaseOutput {
  url:              string;
  /** Numeric AON Diseases.aspx ID extracted from the URL query string. */
  disease_id:       number | null;
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
  saving_throw:     DiseaseSavingThrow | null;
  onset:            string | null;
  maximum_duration: string | null;

  // ─── Stages ────────────────────────────────────────────────────────────────
  stages:           DiseaseStage[];

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

/** Fields owned by `extract-disease-base`. */
export interface DiseaseBaseSlice {
  url:             string;
  disease_id:      number | null;
  name:            string;
  level:           number | null;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          DiseaseOutput['source'];
  sources:         SourceRef[];
}

/** Fields owned by `extract-disease-mechanics`. */
export interface DiseaseMechanicsSlice {
  saving_throw:     DiseaseSavingThrow | null;
  onset:            string | null;
  maximum_duration: string | null;
}

/** Fields owned by `extract-disease-stages`. */
export interface DiseaseStagesSlice {
  stages: DiseaseStage[];
}

/** Fields owned by `extract-disease-meta`. */
export interface DiseaseMetaSlice {
  /** Marker so `state.output` accumulates the slice. */
  __disease_meta_marked: true;
}

// ─── Affliction helpers ───────────────────────────────────────────────────────

/** Return the page region containing the affliction stage markers. */
function locateAfflictionBlock(c: CommonExtraction): string {
  return c.body_html;
}

/** Header lookup with body-HTML fallback for label `name`. */
function getDiseaseField(c: CommonExtraction, label: string): string | null {
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
 * Parse disease stages from affliction block HTML using shared capability.
 * Converts AfflictionStage (body_text, duration) to DiseaseStage (body_text, body_html, duration).
 */
function parseDiseaseStages(html: string): DiseaseStage[] {
  const stages = parseAfflictionStages(html);
  const diseaseStages: DiseaseStage[] = [];

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
      diseaseStages.push({
        stage: stage.stage,
        body_text: stage.body_text,
        body_html: segHtml,
        duration: stage.duration,
      });
    }
  }
  return diseaseStages;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract identity + header scalars for a disease page. */
export function extractDiseaseBase(c: CommonExtraction): DiseaseBaseSlice {
  return {
    url:             c.url,
    disease_id:      extractEntityId(c.url),
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
export function extractDiseaseMechanics(c: CommonExtraction): DiseaseMechanicsSlice {
  const rawSt = getDiseaseField(c, 'Saving Throw');
  const parsed = parseSavingThrow(rawSt);
  const saving_throw: DiseaseSavingThrow | null = parsed === null
    ? null
    : { ...parsed, raw: rawSt! };
  return {
    saving_throw,
    onset:            getDiseaseField(c, 'Onset'),
    maximum_duration: getDiseaseField(c, 'Maximum Duration'),
  };
}

/** Extract Stage N progression markers from the body affliction block. */
export function extractDiseaseStages(c: CommonExtraction): DiseaseStagesSlice {
  return { stages: parseDiseaseStages(locateAfflictionBlock(c)) };
}

/** Extract meta-slice marker — sections/links/body/meta attach in finalize. */
export function extractDiseaseMeta(_c: CommonExtraction): DiseaseMetaSlice {
  return { __disease_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

/** AON labels claimed by upstream disease slices. */
const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Saving Throw', 'Onset', 'Maximum Duration',
];

export function finalizeDisease(
  c:         CommonExtraction,
  base:      DiseaseBaseSlice,
  mech:      DiseaseMechanicsSlice,
  stages:    DiseaseStagesSlice,
  _meta:     DiseaseMetaSlice,
  $:         CheerioAPI,
  _target:   CheerioNode,
): DiseaseOutput {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  return {
    url:              base.url,
    disease_id:       base.disease_id,
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
  } satisfies DiseaseOutput;
}

/** Project a Diseases.aspx page into a typed DiseaseOutput (direct-call wrapper). */
export function extractDisease(
  c:      CommonExtraction,
  $:      CheerioAPI,
  target: CheerioNode,
): DiseaseOutput {
  const base   = extractDiseaseBase(c);
  const mech   = extractDiseaseMechanics(c);
  const stages = extractDiseaseStages(c);
  const meta   = extractDiseaseMeta(c);
  return finalizeDisease(c, base, mech, stages, meta, $, target);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type DiseaseBaseOutput = 'success' | 'error';

export const diseaseBaseNode: NodeInterface<ScrapeState, DiseaseBaseOutput, RipperServices> = {
  name:    'extract:disease-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: DiseaseBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractDiseaseBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type DiseaseMechanicsOutput = 'success' | 'error';

export const diseaseMechanicsNode: NodeInterface<ScrapeState, DiseaseMechanicsOutput, RipperServices> = {
  name:    'extract:disease-mechanics',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: DiseaseMechanicsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const mech = extractDiseaseMechanics(c);

    state.output = { ...state.output, ...mech };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type DiseaseStagesOutput = 'success' | 'error';

export const diseaseStagesNode: NodeInterface<ScrapeState, DiseaseStagesOutput, RipperServices> = {
  name:    'extract:disease-stages',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: DiseaseStagesOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const stagesSlice = extractDiseaseStages(c);

    state.output = { ...state.output, ...stagesSlice };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeDiseaseOutput = 'success';

export const finalizeDiseaseNode: NodeInterface<ScrapeState, FinalizeDiseaseOutput, RipperServices> = {
  name:    'finalize:disease',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeDiseaseOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };

    // Pass a meta marker object inline — finalizeDisease ignores it (void _meta).
    const meta   = { __disease_meta_marked: true as const };
    const acc = (state.output ?? {}) as unknown as DiseaseOutput;
    const assembled = finalizeDisease(c, acc, acc, acc, meta, $, target);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const diseaseConcept: ConceptDecl<DiseaseOutput> = {
  id:       'disease',
  parent:   'entity',
  urlPaths: ['diseases'],
  capabilities: [
    diseaseBaseNode,
    diseaseMechanicsNode,
    diseaseStagesNode,
    finalizeDiseaseNode,
  ],
};
