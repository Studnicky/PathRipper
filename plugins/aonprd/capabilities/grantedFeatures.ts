// Capability: extract:granted-features
// Helper that parses `<h2 class="title">` / `<h3 class="title">` sections from
// a Section list and extracts each as a typed feature entry. Used by: ancestry,
// class, archetype, subclass-feature.
//
// No NodeInterface (pure helper). Consumers call this directly to filter sections
// and project them into feature entries.

import type { Section } from '../../../src/taxonomy/ExtractionStrategy.js';

/** A granted feature with name and description. */
export interface GrantedFeature {
  /** Display name of the feature. */
  name: string;
  /** Plain-text description of the feature. */
  description: string;
  /** Numeric level, when parseable from the heading. */
  level?: number | null;
  /** Trait pill labels, when present in the section body. */
  traits?: string[];
  /** Action-cost glyph, when present in the heading. */
  action_cost?: string | null;
}

/** Options for parseGrantedFeatures behavior. */
export interface ParseGrantedFeaturesOptions {
  /** Heading level filter (defaults to [2] for h2 only). */
  levels?: readonly (2 | 3)[];
  /** Labels to exclude from the result (case-insensitive). */
  excludeLabels?: readonly string[];
  /** Custom heading predicate override (overrides levels filter). */
  predicate?: (section: Section) => boolean;
}

/**
 * Extract granted features from a Section list.
 *
 * Walks each section in the list and yields a feature entry for sections
 * matching the filter. Each feature carries the section's heading as the
 * feature name and the body_text as the description.
 *
 * @param sections Harvested Section list (typically from CommonExtraction.sections)
 * @param options Optional filter/predicate overrides
 * @returns Array of GrantedFeature entries in source order
 */
export function parseGrantedFeatures(
  sections: readonly Section[],
  options?: ParseGrantedFeaturesOptions,
): GrantedFeature[] {
  const out: GrantedFeature[] = [];
  const levels = options?.levels ?? [2] as const;
  const excludeSet = new Set((options?.excludeLabels ?? []).map((label) => label.toLowerCase()));
  const predicate = options?.predicate;

  for (const section of sections) {
    // Apply custom predicate if provided, otherwise use level filter.
    const include = predicate !== undefined
      ? predicate(section)
      : (levels as readonly (2 | 3)[]).includes(section.level);
    if (!include) continue;

    // Skip if the heading matches an excluded label.
    const headingLower = section.heading.toLowerCase();
    if (excludeSet.has(headingLower)) continue;

    // Skip if body text is empty.
    const description = section.body_text.trim();
    if (description === '') continue;

    out.push({
      name: section.heading,
      description,
    });
  }

  return out;
}
