// Animal-companion advancement extraction node.
import type { CommonExtraction } from '../../common.js';
import { htmlToText } from '../../common.js';
import type { AnimalCompanionAdvancementSlice, AnimalCompanionModification } from './types.js';
import { detectVariant, harvestBoldEntries, readActionGlyph } from './helpers.js';

/**
 * Extract Advanced Maneuver action subsection (when rendered as a
 * `<h3 class="title">…</h3>` block — surfaced as a Section by the shared
 * harvester) and the verbatim uplift modifications harvested from a Unique
 * companion page's body_html.
 */
export function extractAnimalCompanionAdvancement(common: CommonExtraction): AnimalCompanionAdvancementSlice {
  let action_cost = null;
  let body = null;
  // Find the first h3 section whose heading carries an action-cost glyph.
  for (const section of common.sections) {
    if (section.level !== 3) continue;
    const cost = readActionGlyph(section.heading);
    if (cost === null) continue;
    action_cost = cost;
    // Strip the leading `<b>Source</b> … <br/>` and `<hr/>` boilerplate from
    // the section body so we surface only the prose description.
    let prose = section.body_html;
    const sourceMatch = /<b>\s*Source\s*<\/b>[\s\S]*?<br\s*\/?>/i.exec(prose);
    if (sourceMatch !== null) prose = prose.slice(sourceMatch.index + sourceMatch[0].length);
    const hrMatch = /<hr\s*\/?>/i.exec(prose);
    if (hrMatch !== null) prose = prose.slice(hrMatch.index + hrMatch[0].length);
    const text = htmlToText(prose);
    body = text === '' ? null : text;
    break;
  }

  // Modifications: only meaningful on Unique pages. Harvest every <b>Label</b>
  // value pair from body_html, skipping the labels claimed by other slices.
  const modifications: AnimalCompanionModification[] = [];
  if (detectVariant(common.url) === 'unique') {
    const claimed = new Set([
      'base animal companion', 'size', 'melee', 'ranged', 'damage',
      'str', 'dex', 'con', 'int', 'wis', 'cha',
      'hit points', 'skill', 'senses', 'speed',
      'support benefit', 'advanced maneuver',
      'source', 'immunities', 'weaknesses', 'resistances',
    ]);
    const entries = harvestBoldEntries(common.body_html);
    for (const entry of entries) {
      if (claimed.has(entry.label.toLowerCase())) continue;
      if (entry.value_text === '') continue;
      modifications.push({ label: entry.label, text: entry.value_text, html: entry.value_html });
    }
  }

  return {
    advanced_maneuver_action_cost: action_cost,
    advanced_maneuver_body:        body,
    modifications,
  };
}
