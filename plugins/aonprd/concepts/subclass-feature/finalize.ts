// Subclass-feature concept — finalize and meta slice extraction.
import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction } from '../../common.js';
import { extractMetaDescription, extractMetaKeywords, stripStructuredKeys } from '../../common.js';
import { isFlavorBoldLabel } from './helpers.js';
import type {
  SubclassFeatureOutput,
  SubclassFeatureOutputFields,
  SubclassFeatureBaseSlice,
  SubclassFeatureFieldsSlice,
  SubclassFeatureSpellsSlice,
  SubclassFeatureFeaturesSlice,
  SubclassFeatureMetaSlice,
} from './types.js';
import { CLAIMED_FIELD_LABELS } from './types.js';

/** Meta slice marker — sections / links / body / meta tags attach in finalize. */
export function extractSubclassFeatureMeta(_c: CommonExtraction): SubclassFeatureMetaSlice {
  void _c;
  return { __subclass_feature_meta_marked: true };
}

export function finalizeSubclassFeature(
  c:        CommonExtraction,
  base:     SubclassFeatureBaseSlice,
  fields:   SubclassFeatureFieldsSlice,
  spells:   SubclassFeatureSpellsSlice,
  features: SubclassFeatureFeaturesSlice,
  _meta:    SubclassFeatureMetaSlice,
  $:        CheerioAPI,
  _target:  any,
): SubclassFeatureOutputFields {
  void _meta;
  void _target;
  const stripped  = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);
  // Also strip Title-Case multi-word names that survived the claimed list —
  // these are inline ability cards or NPC mentions, not structured data.
  // The granted_features extractor already captures the ones that matter.
  const grantedFeatureNames = new Set(features.granted_features.map((f) => f.name.toLowerCase()));
  const raw_fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(stripped)) {
    if (grantedFeatureNames.has(k.toLowerCase())) continue;
    if (isFlavorBoldLabel(k)) continue;
    raw_fields[k] = v;
  }
  return {
    ...base,
    feature_fields:   fields.feature_fields,
    granted_spells:   spells.granted_spells,
    granted_features: features.granted_features,
    sections:         c.sections,
    raw_fields,
    links:            c.links,
    body_text:        c.body_text,
    body_html:        c.body_html,
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  } satisfies SubclassFeatureOutputFields;
}

/**
 * Project a subclass-feature AON page into a typed `SubclassFeatureOutput`.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through the
 * decomposed subclass-feature extraction nodes.
 */
export function extractSubclassFeature(
  c:      CommonExtraction,
  $:      CheerioAPI,
  target: any,
): SubclassFeatureOutputFields {
  const extractSubclassFeatureBase = require('./base.js').extractSubclassFeatureBase;
  const extractSubclassFeatureFields = require('./base.js').extractSubclassFeatureFields;
  const extractSubclassFeatureSpells = require('./base.js').extractSubclassFeatureSpells;
  const extractSubclassFeatureFeatures = require('./base.js').extractSubclassFeatureFeatures;

  const base     = extractSubclassFeatureBase(c);
  const fields   = extractSubclassFeatureFields(c);
  const spells   = extractSubclassFeatureSpells(c);
  const features = extractSubclassFeatureFeatures(c);
  const meta     = extractSubclassFeatureMeta(c);
  return finalizeSubclassFeature(c, base, fields, spells, features, meta, $, target);
}
