//
// Three decomposed slices: base (identity + sources), identity (italic flavor
// blurb), and build (ability scores + skills + research field + feats +
// implements + extra_sections). Finalize assembles raw_fields + meta.
//
// captures any unclassified h2 sections so no data is silently dropped.
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
  htmlToText,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';

// ─── Inlined from Wave 5: class-sample.ts ──────────────────────────────────
// ─── Output type ──────────────────────────────────────────────────────────────

/** A linked feat reference with optional level annotation (e.g. "(2nd)"). */
export interface ClassSampleFeatRef {
  /** Display name. */
  name:    string;
  /** Feats.aspx ID parsed from the anchor href. */
  feat_id: number | null;
  /** Optional level annotation extracted from a trailing `(Nth)` token. */
  level:   number | null;
}

/** A linked skill reference. */
export interface ClassSampleSkillRef {
  name:     string;
  skill_id: number | null;
}

/** A linked archetype/class reference parsed from a heading or anchor. */
export interface ClassSampleNamedRef {
  name: string;
  id:   number | null;
  /** Path component of the AON href — `ResearchFields`, `Implements`, etc. */
  kind: string;
}

export interface ClassSampleOutput {
  url:              string;
  /** Numeric AON ClassSamples.aspx ID extracted from the URL query string. */
  class_sample_id:  number | null;
  name:             string;
  rarity:           Rarity;
  pfs:              PfsLegality | null;
  legacy:           boolean;
  alt_edition_url:  string | null;
  traits:           string[];
  trait_ids:        Record<string, number>;
  source:           { book: string | null; page: number | null; source_id: number | null };
  sources:          SourceRef[];

  // ─── Identity ─────────────────────────────────────────────────────────────
  /** Italic flavor sentence between the header and the first feat-list section. */
  flavor:           string | null;

  // ─── Build sheet ──────────────────────────────────────────────────────────
  /** Ability Scores prose, verbatim. */
  ability_scores:    string | null;
  /** Skills.aspx links from the Skills section. */
  skills:            ClassSampleSkillRef[];
  /** Research field link (alchemist samples only — Chirurgeon, Bomber, Mutagenist…). */
  research_field:    ClassSampleNamedRef | null;
  /** Starting Feat link. */
  starting_feat:     ClassSampleFeatRef | null;
  /** Higher-Level Feats links with their listed level. */
  higher_level_feats: ClassSampleFeatRef[];
  /** Implement-like section payload (e.g. "First Implement") with the linked target. */
  implements:        ClassSampleNamedRef[];
  /** Any `<h2 class="title">` sections not consumed above, preserved verbatim. */
  extra_sections:    Section[];

  // ─── Bookkeeping ──────────────────────────────────────────────────────────
  sections:             Section[];
  raw_fields:           Record<string, string>;
  links:                LinkRef[];
  body_text:            string;
  body_html:            string;
  /** `<meta name="description">` content. */
  meta_description:     string | null;
  /** `<meta name="keywords">` content. */
  meta_keywords:        string | null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────────

/** Fields owned by `extract-class-sample-base`. */
export interface ClassSampleBaseSlice {
  url:             string;
  class_sample_id: number | null;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          ClassSampleOutput['source'];
  sources:         SourceRef[];
}

/** Fields owned by `extract-class-sample-identity`. */
export interface ClassSampleIdentitySlice {
  flavor: string | null;
}

/** Fields owned by `extract-class-sample-build`. */
export interface ClassSampleBuildSlice {
  ability_scores:     string | null;
  skills:             ClassSampleSkillRef[];
  research_field:     ClassSampleNamedRef | null;
  starting_feat:      ClassSampleFeatRef | null;
  higher_level_feats: ClassSampleFeatRef[];
  implements:         ClassSampleNamedRef[];
  extra_sections:     Section[];
}

/** Fields owned by `extract-class-sample-meta`. */
export interface ClassSampleMetaSlice {
  /** Marker so `state.output` accumulates the slice. */
  __class_sample_meta_marked: true;
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

/** Extract base identity + header scalars for a class sample page. */
export function extractClassSampleBase(c: CommonExtraction): ClassSampleBaseSlice {
  return {
    url:             c.url,
    class_sample_id: extractEntityId(c.url),
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

/**
 * Extract the italic flavor blurb between `<b>Source</b>` and the first
 * `<h2 class="title">` heading. Returns `null` when no flavor is present.
 */
export function extractClassSampleIdentity(c: CommonExtraction): ClassSampleIdentitySlice {
  // body_html (post-Source) holds: `<i>flavor</i><br /><h2 class="title">…</h2>`
  // Cut at the first `<h2 class="title">` boundary, then strip the surrounding
  // italics. body_html on class-sample pages with no `<hr/>` is the post-
  // Source fragment courtesy of `splitOnHr`'s no-hr fallback.
  const headingCut = /<h2\b[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>/i.exec(c.body_html);
  const head = headingCut !== null ? c.body_html.slice(0, headingCut.index) : c.body_html;
  const flavorText = htmlToText(head);
  return { flavor: flavorText === '' ? null : flavorText };
}

// ─── Section parsers ──────────────────────────────────────────────────────────

/**
 * Parse a comma-separated list of `<a href="…">name</a>` anchors. The AON HTML
 * on these pages occasionally nests the `</u>` and `</a>` boundaries oddly
 * (`<u><a href>name</u></a>`) so we walk anchors with a tolerant scanner.
 */
function parseAnchorList(html: string): Array<{ name: string; href: string; id: number | null; kind: string }> {
  const out: Array<{ name: string; href: string; id: number | null; kind: string }> = [];
  const re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1] ?? '';
    const inner = m[2] ?? '';
    const name = htmlToText(inner);
    if (name === '') continue;
    const aspxMatch = /([A-Za-z][A-Za-z0-9]*)\.aspx/.exec(href);
    const kind = aspxMatch !== null ? aspxMatch[1]! : '';
    const idMatch = /[?&]ID=(\d+)/i.exec(href);
    const id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    out.push({ name, href, id: id !== null && Number.isFinite(id) ? id : null, kind });
  }
  return out;
}

/** Parse the Higher-Level Feats section — comma list with `(Nth)` annotations. */
function parseHigherLevelFeats(body_html: string): ClassSampleFeatRef[] {
  const anchors = parseAnchorList(body_html);
  // Strip anchors from the text body then walk the remaining tokens between
  // anchors looking for `(Nth)` annotations to pair with the prior anchor.
  // The simpler approach: project body_text → split on commas → match
  // `<name> (Nth)`. We do the latter for reliability.
  const text = htmlToText(body_html);
  const idsByName = new Map<string, number | null>();
  for (const a of anchors) {
    if (a.kind !== 'Feats') continue;
    if (!idsByName.has(a.name)) idsByName.set(a.name, a.id);
  }
  const out: ClassSampleFeatRef[] = [];
  // Split on commas at depth 0 (parens) so `(Nth)` annotations stay with names.
  const parts: string[] = [];
  let buf = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim() !== '') parts.push(buf);
  for (const part of parts) {
    const m = /^\s*(.+?)\s*(?:\((\d+)(?:st|nd|rd|th)\))?\s*$/i.exec(part);
    if (m === null) continue;
    const rawName = m[1]?.trim() ?? '';
    if (rawName === '') continue;
    const level = m[2] !== undefined ? parseInt(m[2]!, 10) : null;
    const feat_id = idsByName.get(rawName) ?? null;
    out.push({ name: rawName, feat_id, level: Number.isFinite(level) ? level : null });
  }
  return out;
}

/** Parse a section that holds exactly one anchor + optional surrounding text. */
function parseSingleAnchor(section: Section, expectedKind: string | null): ClassSampleNamedRef | null {
  for (const link of section.links) {
    if (expectedKind !== null && link.kind !== expectedKind) continue;
    if (link.text.trim() === '') continue;
    return { name: link.text, id: link.id, kind: link.kind };
  }
  // Fallback — first link regardless of kind.
  const first = section.links[0];
  if (first === undefined) return null;
  return { name: first.text, id: first.id, kind: first.kind };
}

const KNOWN_BUILD_HEADINGS = new Set<string>([
  'ability scores',
  'skills',
  'research field',
  'starting feat',
  'higher-level feats',
]);

/**
 * Project every `<h2 class="title">` section into the structured build sheet,
 * preserving any unclassified sections under `extra_sections` so no data is
 * silently dropped.
 */
export function extractClassSampleBuild(c: CommonExtraction): ClassSampleBuildSlice {
  let ability_scores:     string | null = null;
  const skills:           ClassSampleSkillRef[] = [];
  let research_field:     ClassSampleNamedRef | null = null;
  let starting_feat:      ClassSampleFeatRef | null = null;
  let higher_level_feats: ClassSampleFeatRef[] = [];
  const implements_:      ClassSampleNamedRef[] = [];
  const extra_sections:   Section[] = [];

  for (const section of c.sections) {
    if (section.level !== 2) {
      extra_sections.push(section);
      continue;
    }
    const heading = section.heading.toLowerCase();
    if (heading === 'ability scores') {
      ability_scores = section.body_text.trim() === '' ? null : section.body_text.trim();
      continue;
    }
    if (heading === 'skills') {
      for (const link of section.links) {
        if (link.kind !== 'Skills') continue;
        skills.push({ name: link.text, skill_id: link.id });
      }
      continue;
    }
    if (heading === 'research field') {
      research_field = parseSingleAnchor(section, 'ResearchFields');
      continue;
    }
    if (heading === 'starting feat') {
      const ref = parseSingleAnchor(section, 'Feats');
      if (ref !== null) starting_feat = { name: ref.name, feat_id: ref.id, level: null };
      continue;
    }
    if (heading === 'higher-level feats') {
      higher_level_feats = parseHigherLevelFeats(section.body_html);
      continue;
    }
    if (heading.endsWith('implement')) {
      const ref = parseSingleAnchor(section, null);
      if (ref !== null) implements_.push(ref);
      continue;
    }
    if (!KNOWN_BUILD_HEADINGS.has(heading)) {
      extra_sections.push(section);
    }
  }

  return {
    ability_scores,
    skills,
    research_field,
    starting_feat,
    higher_level_feats,
    implements: implements_,
    extra_sections,
  };
}

/** Extract meta slice marker — sections/links/body/meta attach in finalize. */
export function extractClassSampleMeta(_c: CommonExtraction): ClassSampleMetaSlice {
  return { __class_sample_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = ['Source'];

export function finalizeClassSample(
  c:        CommonExtraction,
  base:     ClassSampleBaseSlice,
  identity: ClassSampleIdentitySlice,
  build:    ClassSampleBuildSlice,
  _meta:    ClassSampleMetaSlice,
  $:        CheerioAPI,
  _target:  CheerioNode,
): ClassSampleOutput {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    ...identity,
    ...build,
    sections:         c.sections,
    raw_fields,
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies ClassSampleOutput;
}

/**
 * Project a ClassSamples.aspx page into a typed ClassSampleOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through
 * the decomposed class-sample extraction nodes.
 */
export function extractClassSample(
  c:      CommonExtraction,
  $:      CheerioAPI,
  target: CheerioNode,
): ClassSampleOutput {
  const base     = extractClassSampleBase(c);
  const identity = extractClassSampleIdentity(c);
  const build    = extractClassSampleBuild(c);
  const meta     = extractClassSampleMeta(c);
  return finalizeClassSample(c, base, identity, build, meta, $, target);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

// Node: extract:class-sample-base
// Identity + sources slice.

export type ClassSampleBaseOutput = 'success' | 'error';

export const classSampleBaseNode: NodeInterface<ScrapeState, ClassSampleBaseOutput, RipperServices> = {
  name:    'extract:class-sample-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: ClassSampleBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractClassSampleBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:class-sample-identity
// Italic flavor blurb between Source line and the first feat-list section.

export type ClassSampleIdentityOutput = 'success' | 'error';

export const classSampleIdentityNode: NodeInterface<ScrapeState, ClassSampleIdentityOutput, RipperServices> = {
  name:    'extract:class-sample-identity',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: ClassSampleIdentityOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const slice = extractClassSampleIdentity(c);

    state.output = { ...state.output, ...slice };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:class-sample-build
// Ability scores, skills, research field, feats, implements, extra_sections.

export type ClassSampleBuildOutput = 'success' | 'error';

export const classSampleBuildNode: NodeInterface<ScrapeState, ClassSampleBuildOutput, RipperServices> = {
  name:    'extract:class-sample-build',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: ClassSampleBuildOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const slice = extractClassSampleBuild(c);

    state.output = { ...state.output, ...slice };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: finalize:class-sample
// Assembles raw_fields + sections + meta tags.

export type FinalizeClassSampleOutput = 'success';

export const finalizeClassSampleNode: NodeInterface<ScrapeState, FinalizeClassSampleOutput, RipperServices> = {
  name:    'finalize:class-sample',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon', 'aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeClassSampleOutput }> {
    const c      = state.getMetadata<CommonExtraction>('aonprdCommon');
    const $      = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (c === undefined || $ === undefined || target === undefined) return { output: 'success' };

    const meta     = { __class_sample_meta_marked: true as const };
    const acc = (state.output ?? {}) as unknown as ClassSampleOutput;
    const assembled = finalizeClassSample(c, acc, acc, acc, meta, $, target);
    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

// ─── ConceptDecl export ───────────────────────────────────────────────────────

/**
 * Class-sample concept declaration for the AONPRD taxonomy.
 * Imported by `plugins/aonprd/taxonomy/aonprd.ts`.
 */
export const classSampleConcept: ConceptDecl<ClassSampleOutput> = {
  id:       'class-sample',
  parent:   'entity',
  urlPaths: ['classsamples'],
  capabilities: [
    classSampleBaseNode,
    classSampleIdentityNode,
    classSampleBuildNode,
    finalizeClassSampleNode,
  ],
};
