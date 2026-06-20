// extract:class-subclasses slice.

import type { CommonExtraction } from '../../common.js';
import {
  extractSubclasses,
  isSubclassLabel,
  extractSubclassFeaturesFromHead,
  getHeadHtml,
} from './helpers.js';
import type { ClassSubclassesSlice } from './types.js';

const CLAIMED_FIELD_LABELS: ReadonlyArray<string> = [
  'Source', 'Class Features', 'Hit Points', 'Key Attribute', 'Key Ability',
  'Initial Proficiencies', 'Class DC',
];

export function extractClassSubclasses(common: CommonExtraction): ClassSubclassesSlice {
  const subclasses = extractSubclasses(common.sections);
  const claimed = new Set<string>(CLAIMED_FIELD_LABELS.map((label) => label.toLowerCase()));
  for (const sub of subclasses) claimed.add(sub.name.toLowerCase());

  const out: Array<{ name: string; description: string }> = [];
  const seen = new Set<string>();

  // Source 1: harvested fields with subclass-looking labels.
  for (const field of common.fields) {
    if (!isSubclassLabel(field.label, claimed)) continue;
    if (seen.has(field.label)) continue;
    const description = field.value_text.trim();
    if (description === '') continue;
    seen.add(field.label);
    out.push({ name: field.label, description });
  }

  // Source 2: bare-bold tokens in head HTML (for layouts that don't field-pair).
  const headHtml = getHeadHtml(common.body_html);
  for (const entry of extractSubclassFeaturesFromHead(headHtml, claimed)) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    out.push(entry);
  }

  return { subclasses, subclass_features: out };
}
