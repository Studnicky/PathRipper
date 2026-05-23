// Familiar prerequisites extraction node.
import type { CommonExtraction } from '../../common.js';
import { getField, asInt } from '../../common.js';
import type { FamiliarPrerequisitesSlice } from './types.js';
import {
  parseAbilityType,
  parseGrantedAbilities,
  pullFieldHtml,
  pullField,
  bodyHeadFragment,
} from './helpers.js';

/**
 * Extract the prerequisite fields: ability discriminator + specific-familiar
 * parent (ability pages) and required-ability-count + granted-abilities list
 * (specific-familiar pages). Also pulls `Frequency` / `Trigger` / `Effect`
 * header fields when present (some ability pages, e.g. activated familiar
 * abilities, carry an inline activation block).
 *
 * Familiar pages emit no `<hr />` between header fields and prose, so
 * `c.field_map` is typically empty. We scrape the labels from the pre-`<h2>`
 * prose slice of `c.body_html` instead.
 */
export function extractFamiliarPrerequisites(c: CommonExtraction): FamiliarPrerequisitesSlice {
  const headFragment = bodyHeadFragment(c.body_html);

  const abilityTypeHtml = pullFieldHtml(headFragment, 'Ability Type');
  const { ability_type, specific_familiar_parent } = parseAbilityType(abilityTypeHtml);

  const granted_html = pullFieldHtml(headFragment, 'Granted Abilities');
  const granted_abilities = parseGrantedAbilities(granted_html);

  const reqText = pullField(headFragment, 'Required Number of Abilities');
  const required_number_of_abilities = asInt(reqText);

  return {
    ability_type,
    specific_familiar_parent,
    required_number_of_abilities,
    granted_abilities,
    frequency: pullField(headFragment, 'Frequency') ?? getField(c, 'Frequency'),
    trigger:   pullField(headFragment, 'Trigger')   ?? getField(c, 'Trigger'),
    effect:    pullField(headFragment, 'Effect')    ?? getField(c, 'Effect'),
  };
}
