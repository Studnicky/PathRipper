//
// Affliction pages (Diseases.aspx) carry a statblock with Saving Throw, Onset,
// Maximum Duration, and Stage N progression markers. This concept delegates
// Helpers are inlined with inline contracts. The `entity_id` alias was
// dropped in favour of the concept-specific `disease_id`.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { OperationContractFragmentType } from '@studnicky/dagonizer/contracts';
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
function locateAfflictionBlock(common: CommonExtraction): string {
  return common.body_html;
}

/** Header lookup with body-HTML fallback for label `name`. */
function getDiseaseField(common: CommonExtraction, label: string): string | null {
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
 * Parse disease stages from affliction block HTML using shared capability.
 * Converts AfflictionStage (body_text, duration) to DiseaseStage (body_text, body_html, duration).
 */
function parseDiseaseStages(html: string): DiseaseStage[] {
  const stages = parseAfflictionStages(html);
  const diseaseStages: DiseaseStage[] = [];

  // Rebuild HTML segments for each stage to populate body_html.
  const regex = /<b>\s*Stage\s+(\d+)\s*<\/b>/gi;
  const matches: Array<{ stage: number; index: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const stage = parseInt(match[1] ?? '0', 10);
    if (Number.isFinite(stage)) {
      matches.push({ stage, index: match.index, end: match.index + match[0].length });
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
export function extractDiseaseBase(common: CommonExtraction): DiseaseBaseSlice {
  return {
    url:             common.url,
    disease_id:      extractEntityId(common.url),
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
export function extractDiseaseMechanics(common: CommonExtraction): DiseaseMechanicsSlice {
  const rawSt = getDiseaseField(common, 'Saving Throw');
  const parsed = parseSavingThrow(rawSt);
  const saving_throw: DiseaseSavingThrow | null = parsed === null
    ? null
    : { ...parsed, raw: rawSt! };
  return {
    saving_throw,
    onset:            getDiseaseField(common, 'Onset'),
    maximum_duration: getDiseaseField(common, 'Maximum Duration'),
  };
}

/** Extract Stage N progression markers from the body affliction block. */
export function extractDiseaseStages(common: CommonExtraction): DiseaseStagesSlice {
  return { stages: parseDiseaseStages(locateAfflictionBlock(common)) };
}

/** Extract meta-slice marker — sections/links/body/meta attach in finalize. */
export function extractDiseaseMeta(_common: CommonExtraction): DiseaseMetaSlice {
  return { __disease_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

/** AON labels claimed by upstream disease slices. */
const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Saving Throw', 'Onset', 'Maximum Duration',
];

export function finalizeDisease(
  common:    CommonExtraction,
  base:      DiseaseBaseSlice,
  mech:      DiseaseMechanicsSlice,
  stages:    DiseaseStagesSlice,
  _meta:     DiseaseMetaSlice,
  root:      CheerioAPI,
  _target:   CheerioNode,
): DiseaseOutput {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
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
    sections:         common.sections,
    raw_fields,
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies DiseaseOutput;
}

/** Project a Diseases.aspx page into a typed DiseaseOutput (direct-call wrapper). */
export function extractDisease(
  common: CommonExtraction,
  root:   CheerioAPI,
  target: CheerioNode,
): DiseaseOutput {
  const base   = extractDiseaseBase(common);
  const mech   = extractDiseaseMechanics(common);
  const stages = extractDiseaseStages(common);
  const meta   = extractDiseaseMeta(common);
  return finalizeDisease(common, base, mech, stages, meta, root, target);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type DiseaseBaseOutput = 'success' | 'error';

class DiseaseBaseNode extends ScalarNode<ScrapeState, DiseaseBaseOutput> {
  public readonly name = 'extract:disease-base';
  public readonly outputs = CAPABILITY_OUTPUTS;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<DiseaseBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractDiseaseBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const diseaseBaseNode = new DiseaseBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

export type DiseaseMechanicsOutput = 'success' | 'error';

class DiseaseMechanicsNode extends ScalarNode<ScrapeState, DiseaseMechanicsOutput> {
  public readonly name = 'extract:disease-mechanics';
  public readonly outputs = CAPABILITY_OUTPUTS;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<DiseaseMechanicsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const mech = extractDiseaseMechanics(common);

    state.output = { ...state.output, ...mech };

    return NodeOutputBuilder.of('success');
  }
}

export const diseaseMechanicsNode = new DiseaseMechanicsNode();

// ─────────────────────────────────────────────────────────────────────────────

export type DiseaseStagesOutput = 'success' | 'error';

class DiseaseStagesNode extends ScalarNode<ScrapeState, DiseaseStagesOutput> {
  public readonly name = 'extract:disease-stages';
  public readonly outputs = CAPABILITY_OUTPUTS;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<DiseaseStagesOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const stagesSlice = extractDiseaseStages(common);

    state.output = { ...state.output, ...stagesSlice };

    return NodeOutputBuilder.of('success');
  }
}

export const diseaseStagesNode = new DiseaseStagesNode();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeDiseaseOutput = 'success';

class FinalizeDiseaseNode extends ScalarNode<ScrapeState, FinalizeDiseaseOutput> {
  public readonly name = 'finalize:disease';
  public readonly outputs = ['success'] as const;
  public override readonly contract: OperationContractFragmentType = {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  };

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeDiseaseOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('success');

    // Pass a meta marker object inline — finalizeDisease ignores it (void _meta).
    const meta   = { __disease_meta_marked: true as const };
    const acc = (state.output ?? {}) as unknown as DiseaseOutput;
    const assembled = finalizeDisease(common, acc, acc, acc, meta, root, target);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeDiseaseNode = new FinalizeDiseaseNode();

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
