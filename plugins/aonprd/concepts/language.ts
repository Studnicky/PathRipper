//
// Defines the improved LanguageOutput shape with structured speaker
// buckets, section counts, PFS note extraction, and legacy section filtering.
// Breaking changes from the prior generic-extraction output:
//   - `typical_speakers` (flat ancestry list) is REMOVED.
//   - `speakers` (structured buckets) is the replacement.
//   - `section_counts` is NEW.
//   - `pfs_note` is NEW.
//   - `sections[]` filters out legacy-content-warning headings.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type {
  CommonExtraction,
  CheerioNode,
  Section,
  SourceRef,
  LinkRef,
  Rarity,
  PfsLegality,
} from '../common.js';
import {
  CAPABILITY_OUTPUTS,
  htmlToText,
  extractEntityId,
  stripStructuredKeys,
  filterLegacySections,
  extractPfsNote,
} from '../common.js';
import type { AonprdMetaTags } from '../capabilities/metaTags.js';
import type { ConceptDecl } from '../taxonomy.js';

import { setConceptOutput } from './_helpers.js';
// ─── Speaker types ─────────────────────────────────────────────────────────────

/** A single linked entity harvested from a language speaker section. */
export interface SpeakerRef {
  /** Display name of the entity. */
  name:      string;
  /** AON entity ID parsed from `?ID=N` in the href. Null when absent. */
  aon_id: number | null;
  /**
   * Speaker kind — one of the canonical bucket keys ('ancestry', 'creature',
   * 'npc', 'monster', 'heritage', 'background', 'deity') or the raw lowercased
   * section heading for unknown buckets.
   */
  kind:      string;
  /** Verbatim href from the anchor tag. */
  href:      string;
}

/** Structured speaker buckets harvested from the language page's `<h2>` sections. */
export interface LanguageSpeakers {
  ancestries:  readonly SpeakerRef[];
  creatures:   readonly SpeakerRef[];
  npcs:        readonly SpeakerRef[];
  monsters:    readonly SpeakerRef[];
  heritages:   readonly SpeakerRef[];
  backgrounds: readonly SpeakerRef[];
  deities:     readonly SpeakerRef[];
  /** Catch-all for sections with headings not matching any known bucket. */
  other:       readonly SpeakerRef[];
}

// ─── Language output shape ──────────────────────────────────────────

/** Discriminator for AON Languages.aspx `kind` field, when present. */
export type LanguageKind =
  | 'common'
  | 'uncommon'
  | 'secret'
  | 'dead'
  | 'regional';

/**
 * Output shape for AON Languages.aspx pages with structured speaker
 * buckets and section counts. The `typical_speakers` field is removed; use
 * `speakers.ancestries` instead.
 */
export interface LanguageOutput {
  url:              string;
  /** Numeric AON Languages.aspx ID extracted from the URL query string. */
  language_id:      number | null;
  name:             string;
  rarity:           Rarity;
  pfs:              PfsLegality | null;
  legacy:           boolean;
  alt_edition_url:  string | null;
  traits:           string[];
  trait_ids:        Record<string, number>;
  source:           { book: string | null; page: number | null; source_id: number | null };
  sources:          SourceRef[];

  // ─── Characteristics slice ────────────────────────────────────────────────
  /** Language kind (common/uncommon/secret/dead/regional). Null when AON omits. */
  kind:             LanguageKind | null;
  /** Written script name (e.g. "Common", "Iobaric"). Null when AON omits. */
  script:           string | null;

  // ─── Speaker slice ────────────────────────────────────────────────────────
  /**
   * Structured speaker buckets harvested from h2 sections on the language
   * page. Replaces the deprecated `typical_speakers` flat list.
   */
  speakers:         LanguageSpeakers;
  /**
   * Count annotation per section heading, lowercased. Derived from the
   * `(N)` suffix in `<h2 class="title">Ancestries (48)</h2>`.
   * E.g. `{ ancestries: 48, creatures: 2187 }`.
   */
  section_counts:   Record<string, number>;

  // ─── PFS note ─────────────────────────────────────────────────────────────
  /**
   * Inline PFS Note text extracted from the pre-body annotation.
   * Null when the page has no PFS Note element.
   */
  pfs_note:         string | null;

  // ─── Meta slice ───────────────────────────────────────────────────────────
  /** Brief flavor description (lead paragraph after Source line). */
  description_text: string;
  /** Raw HTML of the lead paragraph. */
  description_html: string;
  /**
   * Page sections. Legacy-content-warning h3 blocks are filtered out;
   * the `legacy: true` flag carries that signal instead.
   */
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Allowed kind labels keyed by lower-case lookup. */
const KIND_MAP: ReadonlyMap<string, LanguageKind> = new Map([
  ['common',   'common'   as const],
  ['uncommon', 'uncommon' as const],
  ['secret',   'secret'   as const],
  ['dead',     'dead'     as const],
  ['regional', 'regional' as const],
]);

/** Coerce a raw label value into a {@link LanguageKind} or null. */
function parseKind(raw: string | null): LanguageKind | null {
  if (raw === null) return null;
  const key = raw.trim().toLowerCase();
  return KIND_MAP.get(key) ?? null;
}

/**
 * Map from a lowercased section heading (stripped of count suffix) to a
 * canonical bucket key on {@link LanguageSpeakers}.
 */
const SECTION_TO_BUCKET: ReadonlyMap<string, keyof Omit<LanguageSpeakers, 'other'>> = new Map([
  ['ancestries',  'ancestries'  as const],
  ['ancestry',    'ancestries'  as const],
  ['creatures',   'creatures'   as const],
  ['creature',    'creatures'   as const],
  ['npcs',        'npcs'        as const],
  ['npc',         'npcs'        as const],
  ['monsters',    'monsters'    as const],
  ['monster',     'monsters'    as const],
  ['heritages',   'heritages'   as const],
  ['heritage',    'heritages'   as const],
  ['backgrounds', 'backgrounds' as const],
  ['background',  'backgrounds' as const],
  ['deities',     'deities'     as const],
  ['deity',       'deities'     as const],
]);

/** Kind label for a given bucket key. */
const BUCKET_KIND: ReadonlyMap<keyof Omit<LanguageSpeakers, 'other'>, string> = new Map([
  ['ancestries',  'ancestry'],
  ['creatures',   'creature'],
  ['npcs',        'npc'],
  ['monsters',    'monster'],
  ['heritages',   'heritage'],
  ['backgrounds', 'background'],
  ['deities',     'deity'],
]);

/**
 * Strip the count suffix `(N)` from a section heading and return the
 * lowercased base text along with the parsed count.
 * E.g. `"Ancestries (48)"` → `{ base: 'ancestries', count: 48 }`.
 */
function parseHeading(heading: string): { base: string; count: number | null } {
  const match = /^(.*?)\s*\((\d+)\)\s*$/.exec(heading.trim());
  if (match !== null) {
    return { base: match[1]!.trim().toLowerCase(), count: parseInt(match[2]!, 10) };
  }
  return { base: heading.trim().toLowerCase(), count: null };
}

/**
 * Harvest every `<a href>` link from an HTML fragment into {@link SpeakerRef}
 * entries. The `kind` is supplied by the caller (derived from the section
 * heading bucket lookup). Duplicate hrefs are dropped.
 *
 * Fallback: when the fragment contains NO anchors but DOES contain prose,
 * split the visible text on commas and emit each token as a SpeakerRef with
 * `aon_id: null` and `href: ''`. This rescues sections like `Regions` on
 * AON language pages that list bare comma-separated names without anchors.
 */
function harvestSectionLinks(html: string, kind: string): SpeakerRef[] {
  const out: SpeakerRef[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) !== null) {
    const href  = match[1] ?? '';
    const inner = match[2] ?? '';
    const name  = htmlToText(inner);
    if (name === '') continue;
    if (seen.has(href)) continue;
    seen.add(href);
    const idMatch  = /[?&]ID=(\d+)/i.exec(href);
    const aon_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    out.push({ name, aon_id, kind, href });
  }

  if (out.length === 0) {
    const text = htmlToText(html);
    if (text !== '') {
      for (const raw of text.split(',')) {
        const name = raw.trim();
        if (name === '') continue;
        if (seen.has(name)) continue;
        seen.add(name);
        out.push({ name, aon_id: null, kind, href: '' });
      }
    }
  }
  return out;
}

/**
 * Build the empty {@link LanguageSpeakers} shape.
 */
function emptyLanguageSpeakers(): {
  ancestries:  SpeakerRef[];
  creatures:   SpeakerRef[];
  npcs:        SpeakerRef[];
  monsters:    SpeakerRef[];
  heritages:   SpeakerRef[];
  backgrounds: SpeakerRef[];
  deities:     SpeakerRef[];
  other:       SpeakerRef[];
} {
  return {
    ancestries:  [],
    creatures:   [],
    npcs:        [],
    monsters:    [],
    heritages:   [],
    backgrounds: [],
    deities:     [],
    other:       [],
  };
}

/**
 * Extract the lead description paragraph from the language page body HTML.
 * Slices from the start of `body_html` up to the first `<h2 class="title">`
 * and trims leading `<br />` separators left from the Source / PFS lines.
 */
function extractDescription(bodyHtml: string): { html: string; text: string } {
  const headingRe = /<h2\s+class="title"/i;
  const idx       = headingRe.exec(bodyHtml);
  const scope     = idx === null ? bodyHtml : bodyHtml.slice(0, idx.index);
  const trimmed   = scope.replace(/^(?:\s*<br\s*\/?>\s*)+/i, '').trim();
  return { html: trimmed, text: htmlToText(trimmed) };
}

// ─── Claimed field labels ─────────────────────────────────────────────────────

/** AON label/value pairs claimed by language capability nodes. */
const CLAIMED_FIELD_LABELS: readonly string[] = [
  'Source', 'Type', 'Kind', 'Script', 'Speakers',
];

// ─── Capability nodes ─────────────────────────────────────────────────────────

// Node: extract:language-base
// Reads aonprdCommon, produces scalar identity fields on state.output.

/** Output type for extract:language-base. */
export type LanguageBaseOutput = 'success' | 'error';

class LanguageBaseNode extends ScalarNode<ScrapeState, LanguageBaseOutput> {
  public readonly name = 'extract:language-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<LanguageBaseOutput, SchemaObjectType> {
    return {
      // state.output merged with language base fields (url, language_id, name, rarity, pfs, traits, source, kind, script)
      success: { type: 'object', properties: { output: { type: 'object' } }, required: ['output'] },
      error:   { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<LanguageBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const kindRaw   = common.field_map['Type'] ?? common.field_map['Kind'] ?? null;
    const scriptRaw = common.field_map['Script'] ?? null;

    const base: Partial<LanguageOutput> = {
      url:             common.url,
      language_id:     extractEntityId(common.url),
      name:            common.title.name,
      rarity:          common.traits.rarity,
      pfs:             common.title.pfs,
      legacy:          common.title.legacy,
      alt_edition_url: common.title.alt_edition_url,
      traits:          common.traits.traits,
      trait_ids:       common.traits.trait_ids,
      source:          { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
      sources:         common.sources,
      kind:            parseKind(kindRaw),
      script:          scriptRaw !== null && scriptRaw.trim() !== '' ? scriptRaw.trim() : null,
    };

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}

export const languageBaseNode = new LanguageBaseNode();

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:language-speakers
// Reads aonprdCommon + sections metadata, produces speakers + section_counts.

/** Output type for extract:language-speakers. */
export type LanguageSpeakersOutput = 'success' | 'error';

class LanguageSpeakersNode extends ScalarNode<ScrapeState, LanguageSpeakersOutput> {
  public readonly name = 'extract:language-speakers';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<LanguageSpeakersOutput, SchemaObjectType> {
    return {
      // state.output gets speakers (object with ancestries/creatures/npcs/monsters/etc arrays) and section_counts (object)
      success: {
        type: 'object',
        properties: {
          speakers:       { type: 'object' },
          section_counts: { type: 'object' },
        },
        required: ['speakers', 'section_counts'],
      },
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<LanguageSpeakersOutput>> {
    const sections = state.getMetadata<Section[]>('sections');
    if (sections === undefined) return NodeOutputBuilder.of('error');

    const buckets = emptyLanguageSpeakers();
    const section_counts: Record<string, number> = {};

    for (const section of sections) {
      const { base, count } = parseHeading(section.heading);
      if (count !== null) {
        section_counts[base] = count;
      }

      const bucketKey = SECTION_TO_BUCKET.get(base);
      const kind = bucketKey !== undefined
        ? (BUCKET_KIND.get(bucketKey) ?? base)
        : base;
      const refs = harvestSectionLinks(section.body_html, kind);

      if (bucketKey !== undefined) {
        const arr = buckets[bucketKey] as SpeakerRef[];
        arr.push(...refs);
      } else {
        buckets.other.push(...refs);
      }
    }

    const speakers: LanguageSpeakers = buckets;

    state.output = state.output !== null
      ? { ...state.output, speakers, section_counts }
      : { speakers, section_counts };

    return NodeOutputBuilder.of('success');
  }
}

export const languageSpeakersNode = new LanguageSpeakersNode();

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:language-pfs-note
// Reads aonprdCheerio + aonprdTarget, produces pfs_note.

/** Output type for extract:language-pfs-note. */
export type LanguagePfsNoteOutput = 'success' | 'error';

class LanguagePfsNoteNode extends ScalarNode<ScrapeState, LanguagePfsNoteOutput> {
  public readonly name = 'extract:language-pfs-note';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<LanguagePfsNoteOutput, SchemaObjectType> {
    return {
      // state.output gets pfs_note: string | null
      success: {
        type: 'object',
        properties: {
          pfs_note: { type: 'string' },
        },
      },
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<LanguagePfsNoteOutput>> {
    const root = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if (root === undefined || target === undefined) return NodeOutputBuilder.of('error');

    const pfs_note = extractPfsNote(root, target);

    state.output = state.output !== null
      ? { ...state.output, pfs_note }
      : { pfs_note };

    return NodeOutputBuilder.of('success');
  }
}

export const languagePfsNoteNode = new LanguagePfsNoteNode();

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:language-description
// Reads aonprdCommon + sections metadata, produces description fields and
// chrome-filtered sections.

/** Output type for extract:language-description. */
export type LanguageDescriptionOutput = 'success' | 'error';

class LanguageDescriptionNode extends ScalarNode<ScrapeState, LanguageDescriptionOutput> {
  public readonly name = 'extract:language-description';
  public readonly outputs = CAPABILITY_OUTPUTS;

  public override get outputSchema(): Record<LanguageDescriptionOutput, SchemaObjectType> {
    return {
      // state.output gets description_text (string), description_html (string), sections (array)
      success: {
        type: 'object',
        properties: {
          description_text: { type: 'string' },
          description_html: { type: 'string' },
          sections:         { type: 'array', items: { type: 'object' } },
        },
        required: ['description_text', 'description_html', 'sections'],
      },
      error: { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<LanguageDescriptionOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    const sections = state.getMetadata<Section[]>('sections');
    if (common === undefined || sections === undefined) return NodeOutputBuilder.of('error');

    const description = extractDescription(common.body_html);
    const filteredSections = filterLegacySections(sections);

    state.output = state.output !== null
      ? {
        ...state.output,
        description_text: description.text,
        description_html: description.html,
        sections:         filteredSections,
      }
      : {
        description_text: description.text,
        description_html: description.html,
        sections:         filteredSections,
      };

    return NodeOutputBuilder.of('success');
  }
}

export const languageDescriptionNode = new LanguageDescriptionNode();

// ─────────────────────────────────────────────────────────────────────────────

// Node: finalize:language
// Reads aonprdCommon + aonprdCheerio, assembles remaining fields and strips
// claimed keys from raw_fields.

/** Output type for finalize:language. */
export type FinalizeLanguageOutput = 'success';

class FinalizeLanguageNode extends ScalarNode<ScrapeState, FinalizeLanguageOutput> {
  public readonly name = 'finalize:language';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<FinalizeLanguageOutput, SchemaObjectType> {
    return {
      // setConceptOutput writes fully assembled LanguageOutput to state.output
      success: { type: 'object', properties: { output: { type: 'object' } }, required: ['output'] },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeLanguageOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    // Open-world soft-fail: any missing prerequisite becomes a no-op success.
    // Upstream extract nodes are responsible for the typed fields on
    // `state.output`; this finalize node layers in the meta slice only.
    if (common === undefined) return NodeOutputBuilder.of('success');

    // Read meta tags from the shared `extract:meta-tags` capability instead of
    // calling `extractMetaDescription` / `extractMetaKeywords` here.
    const meta = state.getMetadata<AonprdMetaTags>('aonprdMetaTags');

    // Read the slices the upstream extract nodes wrote and assemble the
    // full LanguageOutput literal. The `satisfies LanguageOutput` clause is
    // the load-bearing compile-time check — a misspelled key anywhere in
    // the literal below fails `tsc`.
    const acc = (state.output ?? {}) as Partial<LanguageOutput>;

    const assembled = {
      url:              common.url,
      language_id:      acc.language_id ?? null,
      name:             acc.name ?? common.title.name,
      rarity:           acc.rarity ?? common.traits.rarity,
      pfs:              acc.pfs ?? common.title.pfs,
      legacy:           acc.legacy ?? common.title.legacy,
      alt_edition_url:  acc.alt_edition_url ?? common.title.alt_edition_url,
      traits:           acc.traits ?? common.traits.traits,
      trait_ids:        acc.trait_ids ?? common.traits.trait_ids,
      source:           acc.source ?? { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
      sources:          acc.sources ?? common.sources,
      kind:             acc.kind ?? null,
      script:           acc.script ?? null,
      speakers:         acc.speakers ?? {
        ancestries:  [],
        creatures:   [],
        npcs:        [],
        monsters:    [],
        heritages:   [],
        backgrounds: [],
        deities:     [],
        other:       [],
      },
      section_counts:   acc.section_counts ?? {},
      pfs_note:         acc.pfs_note ?? null,
      description_text: acc.description_text ?? '',
      description_html: acc.description_html ?? '',
      sections:         acc.sections ?? [],
      raw_fields:       stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS),
      links:            common.links,
      body_text:        common.body_text,
      body_html:        common.body_html,
      meta_description: meta?.description ?? null,
      meta_keywords:    meta?.keywords    ?? null,
    } satisfies LanguageOutput;

    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}

export const finalizeLanguageNode = new FinalizeLanguageNode();

// ─── ConceptDecl export ───────────────────────────────────────────────────────

/**
 * Language concept declaration for the AONPRD taxonomy.
 * Imported by `plugins/aonprd/taxonomy/aonprd.ts`.
 */
export const languageConcept: ConceptDecl<LanguageOutput> = {
  id:       'language',
  parent:   'entity',
  urlPaths: ['languages'],
  capabilities: [
    languageBaseNode,
    languageDescriptionNode,
    languageSpeakersNode,
    languagePfsNoteNode,
    finalizeLanguageNode,
  ],
};
