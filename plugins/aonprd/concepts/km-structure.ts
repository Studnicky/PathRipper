//
// Kingmaker settlement structure pages (KMStructures.aspx) carry lots, cost,
// construction requirements, upgrade paths, item bonuses, and effect prose.
// Helpers are inlined.
//
// bespoke node-folder under nodes/km-structure/.
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
  type SourceRef,
  type Section,
  type PfsLegality,
  htmlToText,
  harvestLinks,
  getField,
  extractEntityId,
  extractMetaDescription,
  extractMetaKeywords,
  stripStructuredKeys,
} from '../common.js';

// ─── Output shape ─────────────────────────────────────────────────────────────

/** Reference to another KMStructures entry (upgrade path). */
export interface KmStructureRef {
  /** Display name of the structure. */
  name:         string;
  /** AON KMStructures.aspx ID. */
  structure_id: number | null;
}

/** A single Item Bonus / Item Bonuses entry. */
export interface KmStructureItemBonus {
  /** Verbatim raw text of the bonus line — e.g. "+2 item bonus to Creative Solution". */
  raw:   string;
  /** Cross-references harvested from the bonus line (skill/action links). */
  links: LinkRef[];
}

/** A single Cost component (qty + label). */
export interface KmStructureCostComponent {
  /** Numeric quantity — e.g. 52, 12. */
  qty:   number | null;
  /** Resource label — "RP", "Lumber", "Stone", "Luxuries", etc. */
  label: string;
}

export interface KmStructureOutput {
  url:             string;
  structure_id:    number | null;
  name:            string;
  rarity:          Rarity;
  traits:          string[];
  trait_ids:       Record<string, number>;
  level:           number | null;
  source:          { book: string | null; page: number | null; source_id: number | null };
  sources:         SourceRef[];
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;

  // Mechanics
  /** Lots count consumed by the structure (verbatim text — usually "1", "2", "4"). */
  lots:            string | null;
  /** Verbatim cost string ("52 RP, 12 Lumber, 6 Luxuries, 12 Stone"). */
  cost_raw:        string | null;
  /** Parsed cost components (qty + label) — best effort, may be empty for non-standard formats. */
  cost:            KmStructureCostComponent[];
  /** Construction line ("Scholarship (expert) DC 27"). */
  construction:    string | null;
  /** Upgrade-from structures. */
  upgrade_from:    KmStructureRef[];
  /** Upgrade-to structures. */
  upgrade_to:      KmStructureRef[];
  /** Item bonuses granted by the structure. */
  item_bonuses:    KmStructureItemBonus[];
  /** Effects line (prose). */
  effects:         string | null;
  /** Ruin clause when the structure carries one. */
  ruin:            string | null;
  /** Special clause (rare). */
  special:         string | null;
  /** Pre-<hr/> flavor description. */
  description:     string;

  // Bookkeeping
  sections:         Section[];
  raw_fields:       Record<string, string>;
  links:            LinkRef[];
  body_text:        string;
  body_html:        string;
  meta_description: string | null;
  meta_keywords:    string | null;
}

// ─── Per-node slice types ─────────────────────────────────────────────────────

export interface KmStructureBaseSlice {
  url:             string;
  structure_id:    number | null;
  name:            string;
  rarity:          Rarity;
  traits:          string[];
  trait_ids:       Record<string, number>;
  level:           number | null;
  source:          KmStructureOutput['source'];
  sources:         SourceRef[];
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
}

export interface KmStructureMechanicsSlice {
  lots:         string | null;
  cost_raw:     string | null;
  cost:         KmStructureCostComponent[];
  construction: string | null;
  upgrade_from: KmStructureRef[];
  upgrade_to:   KmStructureRef[];
  item_bonuses: KmStructureItemBonus[];
  effects:      string | null;
  ruin:         string | null;
  special:      string | null;
  description:  string;
}

export interface KmStructureMetaSlice {
  /** Marker — meta fields attach in finalize. */
  __km_structure_meta_marked: true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse "qty Label, qty Label, ..." into structured components. */
function parseCostComponents(raw: string | null): KmStructureCostComponent[] {
  if (raw === null || raw.trim() === '') return [];
  const parts = raw.split(',').map((part) => part.trim()).filter((part) => part !== '');
  const out: KmStructureCostComponent[] = [];
  for (const part of parts) {
    const match = /^(\d+)\s+(.+)$/.exec(part);
    if (match !== null) {
      const qty = parseInt(match[1]!, 10);
      out.push({ qty: Number.isFinite(qty) ? qty : null, label: match[2]!.trim() });
    } else {
      out.push({ qty: null, label: part });
    }
  }
  return out;
}

/**
 * Pick the verbatim HTML following `<b>Label</b>` inside `html`, ending at the
 * next `<b>`, `<br>`, `<hr>`, `</span>`, or `<h2>`/`<h3>` subsection.
 */
function pickLabelHtml(html: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const labelRe = new RegExp(`<b>\\s*${escaped}\\s*<\\/b>`, 'i');
  const match = labelRe.exec(html);
  if (match === null) return null;
  const start    = match.index + match[0].length;
  const rest     = html.slice(start);
  const boundary = /<b>|<br\s*\/?>|<hr\s*\/?>|<\/span>|<h[23]\s+class="title"/i.exec(rest);
  const end      = boundary !== null ? boundary.index : rest.length;
  return rest.slice(0, end);
}

/** Parse a `<u><a href="KMStructures.aspx?ID=N">Name</u></a>` list (comma-separated). */
function parseStructureRefs(valueHtml: string | null): KmStructureRef[] {
  if (valueHtml === null) return [];
  const out: KmStructureRef[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b[^>]*href="([^"]*KMStructures\.aspx[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(valueHtml)) !== null) {
    const href = match[1] ?? '';
    const name = htmlToText(match[2] ?? '');
    if (name === '') continue;
    const idMatch = /\?ID=(\d+)/i.exec(href);
    const structure_id = idMatch !== null ? parseInt(idMatch[1]!, 10) : null;
    const key = structure_id !== null ? `id:${structure_id}` : `name:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, structure_id });
  }
  return out;
}

/** Extract the flavor description (pre-`<hr/>` body line). */
function extractDescription(common: CommonExtraction): string {
  // AON km-structure pages put the flavor line between the Source line and
  // <hr/>. With <hr/> present, common.body_html starts after the <hr/> (mechanics).
  // The flavor line lives in the head fragment; we extract it from the field
  // head by scanning for trailing prose after the Source <br/>.
  // Strategy: look for the trailing prose in fields' head. Since our
  // CommonExtraction head/body split via splitOnHr, when there IS an <hr/>,
  // the pre-<hr/> region was head; harvestFields harvested labels there. The
  // flavor sits between the <br/> after Source and the <hr/>. We can recover
  // it by scanning common.url's raw HTML — but we only have CommonExtraction.
  // Use the body_html: km-structure body starts with `<b>Lots</b>...` if it
  // has <hr/>. Otherwise body_html includes flavor at start.
  //
  // Practical approach: if body_html starts with `<b>Lots</b>` (no leading
  // flavor), then no inline flavor description was found. Otherwise capture
  // everything before the first `<b>Lots</b>`.
  const body = common.body_html;
  const lotsRe = /<b>\s*Lots\s*<\/b>/i;
  const match = lotsRe.exec(body);
  if (match === null) return htmlToText(body).trim();
  const prefix = body.slice(0, match.index);
  return htmlToText(prefix).trim();
}

// ─── Per-slice extraction helpers ─────────────────────────────────────────────

export function extractKmStructureBase(common: CommonExtraction): KmStructureBaseSlice {
  return {
    url:             common.url,
    structure_id:    extractEntityId(common.url),
    name:            common.title.name,
    rarity:          common.traits.rarity,
    traits:          common.traits.traits,
    trait_ids:       common.traits.trait_ids,
    level:           common.title.level,
    source:          { book: common.source.book, page: common.source.page, source_id: common.source.source_id },
    sources:         common.sources,
    pfs:             common.title.pfs,
    legacy:          common.title.legacy,
    alt_edition_url: common.title.alt_edition_url,
  };
}

export function extractKmStructureMechanics(common: CommonExtraction): KmStructureMechanicsSlice {
  const body = common.body_html;

  // `Lots N; Cost ...` line. Lots and Cost share the same line separated by `;`.
  const lotsValue        = pickLabelHtml(body, 'Lots');
  const costValue        = pickLabelHtml(body, 'Cost');
  const constructionVal  = pickLabelHtml(body, 'Construction');
  const upgradeFromVal   = pickLabelHtml(body, 'Upgrade From');
  const upgradeToVal     = pickLabelHtml(body, 'Upgrade To');
  // Both singular and plural labels appear in the corpus.
  const itemBonusVal     = pickLabelHtml(body, 'Item Bonus') ?? pickLabelHtml(body, 'Item Bonuses');
  const effectsVal       = pickLabelHtml(body, 'Effects') ?? pickLabelHtml(body, 'Effect');
  const ruinVal          = pickLabelHtml(body, 'Ruin');
  const specialVal       = pickLabelHtml(body, 'Special');

  const lots         = lotsValue !== null ? htmlToText(lotsValue) : null;
  const cost_raw     = costValue !== null ? htmlToText(costValue) : null;
  const cost         = parseCostComponents(cost_raw);

  const item_bonuses: KmStructureItemBonus[] = [];
  if (itemBonusVal !== null) {
    const text = htmlToText(itemBonusVal);
    if (text !== '') {
      item_bonuses.push({ raw: text, links: harvestLinks(itemBonusVal) });
    }
  }

  // Strip trailing semicolon/comma punctuation that can appear on the same line.
  function clean(str: string | null): string | null {
    if (str === null) return null;
    const trimmed = str.trim().replace(/[;,]\s*$/, '').trim();
    return trimmed === '' ? null : trimmed;
  }

  return {
    lots:         clean(lots),
    cost_raw:     clean(cost_raw),
    cost,
    construction: constructionVal !== null ? clean(htmlToText(constructionVal)) : null,
    upgrade_from: parseStructureRefs(upgradeFromVal),
    upgrade_to:   parseStructureRefs(upgradeToVal),
    item_bonuses,
    effects:      effectsVal !== null ? clean(htmlToText(effectsVal)) : null,
    ruin:         ruinVal !== null ? clean(htmlToText(ruinVal)) : null,
    special:      specialVal !== null ? clean(htmlToText(specialVal)) : null,
    description:  extractDescription(common),
  };
}

export function extractKmStructureMeta(_common: CommonExtraction): KmStructureMetaSlice {
  return { __km_structure_meta_marked: true };
}

// ─── Finalize ────────────────────────────────────────────────────────────────

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source',
  'Lots', 'Cost', 'Construction',
  'Upgrade From', 'Upgrade To',
  'Item Bonus', 'Item Bonuses',
  'Effects', 'Effect',
  'Ruin', 'Special',
];

export function finalizeKmStructure(
  common:   CommonExtraction,
  base:     KmStructureBaseSlice,
  mech:     KmStructureMechanicsSlice,
  _meta:    KmStructureMetaSlice,
  root:     CheerioAPI,
): KmStructureOutput {
  void _meta;
  void getField;
  return {
    ...base,
    ...mech,
    sections:         common.sections,
    raw_fields:       stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS),
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies KmStructureOutput;
}

/**
 * Project a KMStructures.aspx page into a typed KmStructureOutput. Thin
 * assembly wrapper for `parseAonHtml` and unit-test direct-call paths.
 */
export function extractKmStructure(common: CommonExtraction, root: CheerioAPI, target: CheerioNode): KmStructureOutput {
  void target;
  const base = extractKmStructureBase(common);
  const mech = extractKmStructureMechanics(common);
  const meta = extractKmStructureMeta(common);
  return finalizeKmStructure(common, base, mech, meta, root);
}

// Re-export output type so tests can import from here.
// ─── Capability nodes ─────────────────────────────────────────────────────────

export type KmStructureBaseOutput = 'success' | 'error';

class KmStructureBaseNodeImpl extends ScalarNode<ScrapeState, KmStructureBaseOutput> {
  public readonly name = 'extract:km-structure-base';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<KmStructureBaseOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const base = extractKmStructureBase(common);

    state.output = { ...state.output, ...base };

    return NodeOutputBuilder.of('success');
  }
}
export const kmStructureBaseNode = new KmStructureBaseNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type KmStructureMechanicsOutput = 'success' | 'error';

class KmStructureMechanicsNodeImpl extends ScalarNode<ScrapeState, KmStructureMechanicsOutput> {
  public readonly name = 'extract:km-structure-mechanics';
  public readonly outputs = CAPABILITY_OUTPUTS;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<KmStructureMechanicsOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('error');

    const mech = extractKmStructureMechanics(common);

    state.output = { ...state.output, ...mech };

    return NodeOutputBuilder.of('success');
  }
}
export const kmStructureMechanicsNode = new KmStructureMechanicsNodeImpl();

// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeKmStructureOutput = 'success';

class FinalizeKmStructureNodeImpl extends ScalarNode<ScrapeState, FinalizeKmStructureOutput> {
  public readonly name = 'finalize:km-structure';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<FinalizeKmStructureOutput>> {
    const common  = state.getMetadata<CommonExtraction>('aonprdCommon');
    const root    = state.getMetadata<CheerioAPI>('aonprdCheerio');
    const target  = state.getMetadata<CheerioNode>('aonprdTarget');
    if (common === undefined || root === undefined) return NodeOutputBuilder.of('success');

    // meta arg is unused by finalizeKmStructure (marker only)
    const acc = (state.output ?? {}) as unknown as KmStructureOutput;
    const assembled = finalizeKmStructure(common, acc, acc, { __km_structure_meta_marked: true }, root);
    void target;

    setConceptOutput(state, assembled);

    return NodeOutputBuilder.of('success');
  }
}
export const finalizeKmStructureNode = new FinalizeKmStructureNodeImpl();

// ─── ConceptDecl export ───────────────────────────────────────────────────────

export const kmStructureConcept: ConceptDecl<KmStructureOutput> = {
  id:       'km-structure',
  parent:   'entity',
  urlPaths: ['kmstructures'],
  capabilities: [
    kmStructureBaseNode,
    kmStructureMechanicsNode,
    finalizeKmStructureNode,
  ],
};
