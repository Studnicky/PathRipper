//
// Three decomposed slices: base (identity + sources), identity (italic flavor
// blurb), and build (ability scores + skills + research field + feats +
// implements + extra_sections). Finalize assembles raw_fields + meta.
//
// captures any unclassified h2 sections so no data is silently dropped.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { ConceptDecl } from '../../../src/types/Taxonomy.js';
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
export function extractClassSampleBase(common: CommonExtraction): ClassSampleBaseSlice {
  return {
    url:             common.url,
    class_sample_id: extractEntityId(common.url),
    name:            common.title.name,
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

/**
 * Extract the italic flavor blurb between `<b>Source</b>` and the first
 * `<h2 class="title">` heading. Returns `null` when no flavor is present.
 */
export function extractClassSampleIdentity(common: CommonExtraction): ClassSampleIdentitySlice {
  // body_html (post-Source) holds: `<i>flavor</i><br /><h2 class="title">…</h2>`
  // Cut at the first `<h2 class="title">` boundary, then strip the surrounding
  // italics. body_html on class-sample pages with no `<hr/>` is the post-
  // Source fragment courtesy of `splitOnHr`'s no-hr fallback.
  const headingCut = /<h2\b[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>/i.exec(common.body_html);
  const head = headingCut !== null ? common.body_html.slice(0, headingCut.index) : common.body_html;
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
  const regex = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1] ?? '';
    const inner = match[2] ?? '';
    const name = htmlToText(inner);
    if (name === '') continue;
    const aspxMatch = /([A-Za-z][A-Za-z0-9]*)\.aspx/.exec(href);
    const kind = aspxMatch !== null ? aspxMatch[1]! : '';
    const idMatch = /[?&]ID=(\d+)/i.exec(href);
    const anchorId = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    out.push({ name, href, id: anchorId !== null && Number.isFinite(anchorId) ? anchorId : null, kind });
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
  for (const anchor of anchors) {
    if (anchor.kind !== 'Feats') continue;
    if (!idsByName.has(anchor.name)) idsByName.set(anchor.name, anchor.id);
  }
  const out: ClassSampleFeatRef[] = [];
  // Split on commas at depth 0 (parens) so `(Nth)` annotations stay with names.
  const parts: string[] = [];
  let buf = '';
  let depth = 0;
  for (const char of text) {
    if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += char;
  }
  if (buf.trim() !== '') parts.push(buf);
  for (const part of parts) {
    const partMatch = /^\s*(.+?)\s*(?:\((\d+)(?:st|nd|rd|th)\))?\s*$/i.exec(part);
    if (partMatch === null) continue;
    const rawName = partMatch[1]?.trim() ?? '';
    if (rawName === '') continue;
    const level = partMatch[2] !== undefined ? parseInt(partMatch[2]!, 10) : null;
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
export function extractClassSampleBuild(common: CommonExtraction): ClassSampleBuildSlice {
  let ability_scores:     string | null = null;
  const skills:           ClassSampleSkillRef[] = [];
  let research_field:     ClassSampleNamedRef | null = null;
  let starting_feat:      ClassSampleFeatRef | null = null;
  let higher_level_feats: ClassSampleFeatRef[] = [];
  const implements_:      ClassSampleNamedRef[] = [];
  const extra_sections:   Section[] = [];

  for (const section of common.sections) {
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
export function extractClassSampleMeta(_common: CommonExtraction): ClassSampleMetaSlice {
  return { __class_sample_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = ['Source'];

export function finalizeClassSample(
  common:   CommonExtraction,
  base:     ClassSampleBaseSlice,
  identity: ClassSampleIdentitySlice,
  build:    ClassSampleBuildSlice,
  _meta:    ClassSampleMetaSlice,
  root:     CheerioAPI,
  _target:  CheerioNode,
): ClassSampleOutput {
  void _meta;
  void _target;
  const raw_fields = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
  return {
    ...base,
    ...identity,
    ...build,
    sections:         common.sections,
    raw_fields,
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
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
  common:  CommonExtraction,
  root:    CheerioAPI,
  target:  CheerioNode,
): ClassSampleOutput {
  const base     = extractClassSampleBase(common);
  const identity = extractClassSampleIdentity(common);
  const build    = extractClassSampleBuild(common);
  const meta     = extractClassSampleMeta(common);
  return finalizeClassSample(common, base, identity, build, meta, root, target);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

// Node: extract:class-sample-base
// Identity + sources slice.

export type ClassSampleBaseOutput = 'success' | 'error';

class ClassSampleBaseNode extends ScalarNode<ScrapeState, ClassSampleBaseOutput> {
  public readonly name = 'extract:class-sample-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<ClassSampleBaseOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: {
            type: 'object',
            properties: {
              url:             { type: 'string' },
              class_sample_id: { type: ['integer', 'null'] },
              name:            { type: 'string' },
              rarity:          { type: 'string' },
              pfs:             { type: ['string', 'null'] },
              legacy:          { type: 'boolean' },
              alt_edition_url: { type: ['string', 'null'] },
              traits:          { type: 'array', items: { type: 'string' } },
              trait_ids:       { type: 'object' },
              source:          { type: 'object' },
              sources:         { type: 'array', items: { type: 'object' } },
            },
            required: ['url', 'name', 'rarity', 'traits', 'trait_ids', 'source', 'sources'],
          },
        },
        required: ['output'],
      },
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<ClassSampleBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractClassSampleBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const classSampleBaseNode = new ClassSampleBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:class-sample-identity
// Italic flavor blurb between Source line and the first feat-list section.

export type ClassSampleIdentityOutput = 'success' | 'error';

class ClassSampleIdentityNode extends ScalarNode<ScrapeState, ClassSampleIdentityOutput> {
  public readonly name = 'extract:class-sample-identity';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<ClassSampleIdentityOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: {
            type: 'object',
            properties: {
              flavor: { type: ['string', 'null'] },
            },
          },
        },
        required: ['output'],
      },
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<ClassSampleIdentityOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const slice = extractClassSampleIdentity(common);

    state.output = { ...state.output, ...slice };

    return NodeOutputBuilder.of('success');
  }
}

export const classSampleIdentityNode = new ClassSampleIdentityNode();

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:class-sample-build
// Ability scores, skills, research field, feats, implements, extra_sections.

export type ClassSampleBuildOutput = 'success' | 'error';

class ClassSampleBuildNode extends ScalarNode<ScrapeState, ClassSampleBuildOutput> {
  public readonly name = 'extract:class-sample-build';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<ClassSampleBuildOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: {
            type: 'object',
            properties: {
              ability_scores:     { type: ['string', 'null'] },
              skills:             { type: 'array', items: { type: 'object' } },
              research_field:     { type: ['object', 'null'] },
              starting_feat:      { type: ['object', 'null'] },
              higher_level_feats: { type: 'array', items: { type: 'object' } },
              implements:         { type: 'array', items: { type: 'object' } },
              extra_sections:     { type: 'array', items: { type: 'object' } },
            },
            required: ['skills', 'higher_level_feats', 'implements', 'extra_sections'],
          },
        },
        required: ['output'],
      },
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<ClassSampleBuildOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const slice = extractClassSampleBuild(common);

    state.output = { ...state.output, ...slice };

    return NodeOutputBuilder.of('success');
  }
}

export const classSampleBuildNode = new ClassSampleBuildNode();

// ─────────────────────────────────────────────────────────────────────────────

// Node: finalize:class-sample
// Assembles raw_fields + sections + meta tags.

export type FinalizeClassSampleOutput = 'success';

class FinalizeClassSampleNode extends ScalarNode<ScrapeState, FinalizeClassSampleOutput> {
  public readonly name = 'finalize:class-sample';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<FinalizeClassSampleOutput, SchemaObjectType> {
    return {
      success: {
        type: 'object',
        properties: {
          output: { type: 'object' },
        },
        required: ['output'],
      },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeClassSampleOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined || target === undefined) return NodeOutputBuilder.of('success');

    const meta     = { __class_sample_meta_marked: true as const };
    const acc = (state.output ?? {}) as unknown as ClassSampleOutput;
    const assembled = finalizeClassSample(common, acc, acc, acc, meta, root, target);
    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeClassSampleNode = new FinalizeClassSampleNode();

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
