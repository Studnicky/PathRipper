// Subclass-feature concept — base, fields, spells, and features slice extraction.
import type { CommonExtraction } from '../../common.js';
import { htmlToText, extractEntityId, stripStructuredKeys } from '../../common.js';
import { resolveFamily, parseRankedSpellList, harvestBoldLabels, parseFeatureHeading, bodyHeadRegion, bodyFeaturesRegion, isFlavorBoldLabel } from './helpers.js';
import type {
  SubclassFeatureBaseSlice,
  SubclassFeatureFieldsSlice,
  SubclassFeatureSpellsSlice,
  SubclassFeatureFeaturesSlice,
  SubclassFeatureSpellGroup,
} from './types.js';
import {
  SPELL_LIST_HEADINGS,
  STRUCTURED_HEADING_LABELS,
  CLAIMED_FIELD_LABELS,
} from './types.js';

/** Base identity slice — URL, ID, name, family/parent_class, traits, sources. */
export function extractSubclassFeatureBase(c: CommonExtraction): SubclassFeatureBaseSlice {
  const fam = resolveFamily(c.url);
  return {
    url:             c.url,
    subclass_feature_id:       extractEntityId(c.url),
    name:            c.title.name,
    subclass_family: fam.subclass_family,
    parent_class:    fam.parent_class,
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
 * Lift the small property bag of header fields into `feature_fields`.
 *
 * Modern layout: each header field lives as a `<div class="subclass-feature">`
 * section already in `c.sections`. We capture the *text* of each non-spell-list
 * section into the property bag, keyed by the section heading. The spell-list
 * sections are excluded because they are parsed structurally into
 * `granted_spells` and granted-feature sections live in `granted_features`.
 *
 * Legacy layout: the head region of `body_html` carries `<b>Label</b> Value`
 * pairs. We harvest them via {@link harvestBoldLabels} and merge into the same
 * map. The standard `c.field_map` is also folded in for completeness.
 */
export function extractSubclassFeatureFields(c: CommonExtraction): SubclassFeatureFieldsSlice {
  const fields: Record<string, string> = {};

  // Modern: pull single-line subclass-feature sections into the property bag.
  for (const section of c.sections) {
    if (section.level !== 2) continue;
    const heading = section.heading.toLowerCase();
    if (STRUCTURED_HEADING_LABELS.has(heading)) continue;
    // Skip granted-feature sections — they generally have multi-line prose
    // bodies or trait pills inside (e.g. `Curse of Outpouring Life`). The
    // property bag stays focused on short single-line label/value entries.
    const bodyText = section.body_text.trim();
    if (bodyText === '') continue;
    if (bodyText.length > 240) continue;
    fields[section.heading] = bodyText;
  }

  // Legacy: walk `<b>Label</b>` pairs in the head region of body_html.
  const head = bodyHeadRegion(c.body_html);
  const labels = harvestBoldLabels(head);
  for (const [key, info] of labels) {
    if (STRUCTURED_HEADING_LABELS.has(key)) continue;
    if (info.text === '') continue;
    // Preserve the AON-cased label rather than the lowercased key.
    const labelMatch = /<b>([\s\S]*?)<\/b>/i.exec(head.slice(0)); // placeholder
    void labelMatch;
    // Recover the original label casing by re-finding the <b> via case-sensitive search.
    const re = new RegExp(`<b>\\s*([^<]*?)\\s*</b>`, 'gi');
    let m: RegExpExecArray | null;
    let labelCased = key;
    while ((m = re.exec(head)) !== null) {
      const candidate = htmlToText(m[1] ?? '').replace(/[:?]$/, '').trim();
      if (candidate.toLowerCase() === key) { labelCased = candidate; break; }
    }
    if (fields[labelCased] === undefined) fields[labelCased] = info.text;
  }

  // Fold in the standard field_map (header source line and friends).
  for (const [key, value] of Object.entries(c.field_map)) {
    if (key.toLowerCase() === 'source') continue;
    if (fields[key] === undefined && value !== '') fields[key] = value;
  }

  return { feature_fields: fields };
}

/**
 * Lift the rank-indexed spell list(s) into `granted_spells`.
 *
 * Modern layout: each spell-list section (e.g. `Sorcerous Gifts`, `Bloodline
 * Spells`, `Granted Spells`, `Revelation Spells`, `Patron Spells`) emits a
 * single `SubclassFeatureSpellGroup` chain. Multiple matching sections are all
 * processed and concatenated in document order, preserving rank ordering.
 *
 * Legacy layout: the head region carries a `<b>Spell List</b> tradition` line
 * (tradition pointer rather than a rank list). That stays as a feature_fields
 * entry; the granted spells live inside the granted-feature blocks (e.g. a
 * Lesson body referencing a spell via `<a href="Spells.aspx?ID=…">name</a>`).
 * We do not synthesize spell groups from such inline references — they're
 * carried in `granted_features[].body_html` for downstream consumers.
 */
export function extractSubclassFeatureSpells(c: CommonExtraction): SubclassFeatureSpellsSlice {
  const groups: SubclassFeatureSpellGroup[] = [];
  for (const section of c.sections) {
    if (!SPELL_LIST_HEADINGS.includes(section.heading.toLowerCase())) continue;
    const parsed = parseRankedSpellList(section.body_html);
    for (const g of parsed) groups.push(g);
  }
  return { granted_spells: groups };
}

/**
 * Lift granted feats / abilities from the body into `granted_features`.
 *
 * Modern: any `c.sections` entry whose heading is not a spell-list heading
 * AND not a short property-bag entry becomes a granted feature. We re-walk
 * `c.sections` rather than parse HTML so the same section that fed
 * `feature_fields` and `granted_spells` is canonical.
 *
 * Legacy: each `<b>Feature Name</b>` pair in the body's features region (after
 * the `<br><br>` separator that follows the header fields) becomes a feature
 * entry. Body content runs until the next `<b>` label or end of body.
 */
export function extractSubclassFeatureFeatures(c: CommonExtraction): SubclassFeatureFeaturesSlice {
  const out: any[] = [];
  const seen = new Set<string>();

  // Modern: long-body sections that aren't spell lists are granted features.
  for (const section of c.sections) {
    const headingLower = section.heading.toLowerCase();
    if (SPELL_LIST_HEADINGS.includes(headingLower)) continue;
    const body_text = section.body_text.trim();
    if (body_text === '') continue;
    // Treat a section as a granted feature if it has notable body content,
    // either a level marker in the heading or any multi-sentence body.
    const parsed = parseFeatureHeading(section.heading);
    const hasLevel = parsed.level !== null;
    const longish  = body_text.length > 60;
    if (!hasLevel && !longish) continue;
    const key = section.heading.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name:      parsed.name,
      level:     parsed.level,
      body_html: section.body_html,
      body_text,
    });
  }

  // Legacy: walk `<b>Feature</b> body` pairs in the features region.
  const features = bodyFeaturesRegion(c.body_html);
  if (features !== '') {
    const labels = harvestBoldLabels(features);
    for (const [key, info] of labels) {
      if (STRUCTURED_HEADING_LABELS.has(key)) continue;
      if (seen.has(key)) continue;
      if (info.text === '') continue;
      // Recover the original label casing.
      const re = new RegExp(`<b>\\s*([^<]*?)\\s*</b>`, 'gi');
      let m: RegExpExecArray | null;
      let nameCased = key;
      while ((m = re.exec(features)) !== null) {
        const candidate = htmlToText(m[1] ?? '').replace(/[:?]$/, '').trim();
        if (candidate.toLowerCase() === key) { nameCased = candidate; break; }
      }
      const parsed = parseFeatureHeading(nameCased);
      seen.add(key);
      out.push({
        name:      parsed.name,
        level:     parsed.level,
        body_html: info.raw_html,
        body_text: info.text,
      });
    }
  }

  return { granted_features: out };
}
