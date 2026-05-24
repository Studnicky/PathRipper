// Language concept — Phase 6.3 taxonomic extraction.
//
// Defines the improved LanguageOutput shape (Wave 6) with structured speaker
// buckets, section counts, PFS note extraction, and legacy section filtering.
// Supersedes the Wave 5 shape in language.ts; that file remains unchanged as
// the running pipeline still uses it.
//
// Breaking change vs Wave 5:
//   - `typical_speakers` (flat ancestry list) is REMOVED.
//   - `speakers` (structured buckets) is the replacement.
//   - `section_counts` is NEW.
//   - `pfs_note` is NEW.
//   - `sections[]` filters out legacy-content-warning headings.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../src/services/RipperServices.js';
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

// ─── Language output shape (Wave 6) ──────────────────────────────────────────

/** Discriminator for AON Languages.aspx `kind` field, when present. */
export type LanguageKind =
  | 'common'
  | 'uncommon'
  | 'secret'
  | 'dead'
  | 'regional';

/**
 * Improved output shape for AON Languages.aspx pages (Wave 6 taxonomic
 * extraction). The `typical_speakers` field from Wave 5 is gone; use
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

  // ─── Speaker slice (Wave 6 replacement for typical_speakers) ─────────────
  /**
   * Structured speaker buckets harvested from h2 sections on the language
   * page. Replaces the Wave 5 `typical_speakers` flat list.
   */
  speakers:         LanguageSpeakers;
  /**
   * Count annotation per section heading, lowercased. Derived from the
   * `(N)` suffix in `<h2 class="title">Ancestries (48)</h2>`.
   * E.g. `{ ancestries: 48, creatures: 2187 }`.
   */
  section_counts:   Record<string, number>;

  // ─── PFS note (Wave 6 new field) ─────────────────────────────────────────
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
  const m = /^(.*?)\s*\((\d+)\)\s*$/.exec(heading.trim());
  if (m !== null) {
    return { base: m[1]!.trim().toLowerCase(), count: parseInt(m[2]!, 10) };
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
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const href  = m[1] ?? '';
    const inner = m[2] ?? '';
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

export const languageBaseNode: NodeInterface<ScrapeState, LanguageBaseOutput, RipperServices> = {
  name:    'extract:language-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: LanguageBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const kindRaw   = c.field_map['Type'] ?? c.field_map['Kind'] ?? null;
    const scriptRaw = c.field_map['Script'] ?? null;

    const base: Partial<LanguageOutput> = {
      url:             c.url,
      language_id:     extractEntityId(c.url),
      name:            c.title.name,
      rarity:          c.traits.rarity,
      pfs:             c.title.pfs,
      legacy:          c.title.legacy,
      alt_edition_url: c.title.alt_edition_url,
      traits:          c.traits.traits,
      trait_ids:       c.traits.trait_ids,
      source:          { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
      sources:         c.sources,
      kind:            parseKind(kindRaw),
      script:          scriptRaw !== null && scriptRaw.trim() !== '' ? scriptRaw.trim() : null,
    };

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:language-speakers
// Reads aonprdCommon + sections metadata, produces speakers + section_counts.

/** Output type for extract:language-speakers. */
export type LanguageSpeakersOutput = 'success' | 'error';

export const languageSpeakersNode: NodeInterface<ScrapeState, LanguageSpeakersOutput, RipperServices> = {
  name:    'extract:language-speakers',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'sections'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: LanguageSpeakersOutput }> {
    const sections = state.getMetadata<Section[]>('sections');
    if (sections === undefined) return { output: 'error' };

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

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:language-pfs-note
// Reads aonprdCheerio + aonprdTarget, produces pfs_note.

/** Output type for extract:language-pfs-note. */
export type LanguagePfsNoteOutput = 'success' | 'error';

export const languagePfsNoteNode: NodeInterface<ScrapeState, LanguagePfsNoteOutput, RipperServices> = {
  name:    'extract:language-pfs-note',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCheerio', 'aonprdTarget'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: LanguagePfsNoteOutput }> {
    const $ = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target = state.getMetadata<CheerioNode>('aonprdTarget');
    if ($ === undefined || target === undefined) return { output: 'error' };

    const pfs_note = extractPfsNote($, target);

    state.output = state.output !== null
      ? { ...state.output, pfs_note }
      : { pfs_note };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: extract:language-description
// Reads aonprdCommon + sections metadata, produces description fields and
// chrome-filtered sections.

/** Output type for extract:language-description. */
export type LanguageDescriptionOutput = 'success' | 'error';

export const languageDescriptionNode: NodeInterface<ScrapeState, LanguageDescriptionOutput, RipperServices> = {
  name:    'extract:language-description',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon', 'sections'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: LanguageDescriptionOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    const sections = state.getMetadata<Section[]>('sections');
    if (c === undefined || sections === undefined) return { output: 'error' };

    const description = extractDescription(c.body_html);
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

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

// Node: finalize:language
// Reads aonprdCommon + aonprdCheerio, assembles remaining fields and strips
// claimed keys from raw_fields.

/** Output type for finalize:language. */
export type FinalizeLanguageOutput = 'success';

export const finalizeLanguageNode: NodeInterface<ScrapeState, FinalizeLanguageOutput, RipperServices> = {
  name:    'finalize:language',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: FinalizeLanguageOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    // Open-world soft-fail: any missing prerequisite becomes a no-op success.
    // Upstream extract nodes are responsible for the typed fields on
    // `state.output`; this finalize node layers in the meta slice only.
    if (c === undefined) return { output: 'success' };

    // Read meta tags from the Wave 4 H5 shared `extract:meta-tags` capability
    // instead of calling `extractMetaDescription` / `extractMetaKeywords` here.
    const meta = state.getMetadata<AonprdMetaTags>('aonprdMetaTags');

    // Read the slices the upstream extract nodes wrote and assemble the
    // full LanguageOutput literal. The `satisfies LanguageOutput` clause is
    // the load-bearing compile-time check that closes Wave 4 H9 — a
    // misspelled key anywhere in the literal below fails `tsc`.
    const acc = (state.output ?? {}) as Partial<LanguageOutput>;

    const assembled = {
      url:              c.url,
      language_id:      acc.language_id ?? null,
      name:             acc.name ?? c.title.name,
      rarity:           acc.rarity ?? c.traits.rarity,
      pfs:              acc.pfs ?? c.title.pfs,
      legacy:           acc.legacy ?? c.title.legacy,
      alt_edition_url:  acc.alt_edition_url ?? c.title.alt_edition_url,
      traits:           acc.traits ?? c.traits.traits,
      trait_ids:        acc.trait_ids ?? c.traits.trait_ids,
      source:           acc.source ?? { book: c.source.book, page: c.source.page, source_id: c.source.source_id },
      sources:          acc.sources ?? c.sources,
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
      raw_fields:       stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS),
      links:            c.links,
      body_text:        c.body_text,
      body_html:        c.body_html,
      meta_description: meta?.description ?? null,
      meta_keywords:    meta?.keywords    ?? null,
    } satisfies LanguageOutput;

    setConceptOutput(state, assembled);

    return { output: 'success' };
  },
};

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
