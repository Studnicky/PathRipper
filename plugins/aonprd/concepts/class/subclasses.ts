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

export function extractClassSubclasses(c: CommonExtraction): ClassSubclassesSlice {
  const subclasses = extractSubclasses(c.sections);
  const claimed = new Set<string>(CLAIMED_FIELD_LABELS.map((l) => l.toLowerCase()));
  for (const s of subclasses) claimed.add(s.name.toLowerCase());

  const out: Array<{ name: string; description: string }> = [];
  const seen = new Set<string>();

  // Source 1: harvested fields with subclass-looking labels.
  for (const f of c.fields) {
    if (!isSubclassLabel(f.label, claimed)) continue;
    if (seen.has(f.label)) continue;
    const description = f.value_text.trim();
    if (description === '') continue;
    seen.add(f.label);
    out.push({ name: f.label, description });
  }

  // Source 2: bare-bold tokens in head HTML (for layouts that don't field-pair).
  const headHtml = getHeadHtml(c.body_html);
  for (const entry of extractSubclassFeaturesFromHead(headHtml, claimed)) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    out.push(entry);
  }

  return { subclasses, subclass_features: out };
}
