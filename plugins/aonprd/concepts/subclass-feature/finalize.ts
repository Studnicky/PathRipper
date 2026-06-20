// Subclass-feature concept — finalize and meta slice extraction.
import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction } from '../../common.js';
import { extractMetaDescription, extractMetaKeywords, stripStructuredKeys } from '../../common.js';
import { isFlavorBoldLabel } from './helpers.js';
import {
  extractSubclassFeatureBase,
  extractSubclassFeatureFields,
  extractSubclassFeatureSpells,
  extractSubclassFeatureFeatures,
} from './base.js';
import type {
  SubclassFeatureOutput,
  SubclassFeatureBaseSlice,
  SubclassFeatureFieldsSlice,
  SubclassFeatureSpellsSlice,
  SubclassFeatureFeaturesSlice,
  SubclassFeatureMetaSlice,
} from './types.js';
import { CLAIMED_FIELD_LABELS } from './types.js';

/** Meta slice marker — sections / links / body / meta tags attach in finalize. */
export function extractSubclassFeatureMeta(_common: CommonExtraction): SubclassFeatureMetaSlice {
  void _common;
  return { __subclass_feature_meta_marked: true };
}

export function finalizeSubclassFeature(
  common:   CommonExtraction,
  base:     SubclassFeatureBaseSlice,
  fields:   SubclassFeatureFieldsSlice,
  spells:   SubclassFeatureSpellsSlice,
  features: SubclassFeatureFeaturesSlice,
  _meta:    SubclassFeatureMetaSlice,
  root:     CheerioAPI,
  _target:  unknown,
): SubclassFeatureOutput {
  void _meta;
  void _target;
  const stripped  = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);
  // Also strip Title-Case multi-word names that survived the claimed list —
  // these are inline ability cards or NPC mentions, not structured data.
  // The granted_features extractor already captures the ones that matter.
  const grantedFeatureNames = new Set(features.granted_features.map((field) => field.name.toLowerCase()));
  const raw_fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(stripped)) {
    if (grantedFeatureNames.has(key.toLowerCase())) continue;
    if (isFlavorBoldLabel(key)) continue;
    raw_fields[key] = value;
  }
  return {
    ...base,
    feature_fields:   fields.feature_fields,
    granted_spells:   spells.granted_spells,
    granted_features: features.granted_features,
    sections:         common.sections,
    raw_fields,
    links:            common.links,
    body_text:        common.body_text,
    body_html:        common.body_html,
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  } satisfies SubclassFeatureOutput;
}

/**
 * Project a subclass-feature AON page into a typed `SubclassFeatureOutput`.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through the
 * decomposed subclass-feature extraction nodes.
 */
export function extractSubclassFeature(
  common:  CommonExtraction,
  root:    CheerioAPI,
  target:  unknown,
): SubclassFeatureOutput {
  const base     = extractSubclassFeatureBase(common);
  const fields   = extractSubclassFeatureFields(common);
  const spells   = extractSubclassFeatureSpells(common);
  const features = extractSubclassFeatureFeatures(common);
  const meta     = extractSubclassFeatureMeta(common);
  return finalizeSubclassFeature(common, base, fields, spells, features, meta, root, target);
}
