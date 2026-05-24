// Skill concept — finalize and meta slice extraction.
import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction, LinkRef } from '../../common.js';
import { htmlToText, harvestLinks, extractMetaDescription, extractMetaKeywords, stripStructuredKeys } from '../../common.js';
import type { SkillOutput, SkillOutputFields, SkillBaseSlice, SkillActionsSlice, SkillProficiencyTiersSlice, SkillMetaSlice } from './types.js';
import { CLAIMED_FIELD_LABELS } from './types.js';

/** Extract whole-page link / body / meta projection. */
export function extractSkillMeta(c: CommonExtraction, $: CheerioAPI, span: any): SkillMetaSlice {
  // Skill pages have no top-level `<hr/>` separator, so `c.body_html` is cut
  // at the first `<hr/>` inside the first action (typically Balance) and only
  // contains the tail of the page. Use the full content span instead so the
  // body / link harvest covers every action on the page.
  const spanHtml = span.html() ?? '';

  // Lift rare metadata blocks. Both labels are simple <b>Label</b> Value<br/>
  // pairs in the head section.
  const addRaw = c.field_map['Additional Traits'];
  const additional_traits: string[] = addRaw === undefined
    ? []
    : addRaw.split(',').map((s) => s.trim()).filter((s) => s !== '');

  let corresponding_skill: { name: string; skill_id: number | null } | null = null;
  const corrRaw = c.field_map['Corresponding Skill'];
  if (corrRaw !== undefined) {
    const name = corrRaw.trim();
    if (name !== '') {
      const link = c.links.find((l) => l.kind === 'Skills' && l.text === name);
      corresponding_skill = { name, skill_id: link?.id ?? null };
    }
  }

  return {
    additional_traits,
    corresponding_skill,
    body_text:        htmlToText(spanHtml),
    body_html:        spanHtml,
    links:            harvestLinks(spanHtml),
    meta_description: extractMetaDescription($),
    meta_keywords:    extractMetaKeywords($),
  };
}

/**
 * Assemble the final SkillOutput from per-slice results.
 *
 * Computes `raw_fields` by stripping every AON label claimed by upstream slices
 * (CLAIMED_FIELD_LABELS). For most skills `c.field_map` is empty (the only
 * head-section bold label is `<b>Source</b>`, which `harvestFields` drops), so
 * `raw_fields` ends up as `{}`.
 */
export function finalizeSkill(
  c:        CommonExtraction,
  base:     SkillBaseSlice,
  actions:  SkillActionsSlice,
  tiers:    SkillProficiencyTiersSlice,
  meta:     SkillMetaSlice,
): SkillOutputFields {
  const raw_fields = stripStructuredKeys(c.field_map, CLAIMED_FIELD_LABELS);

  return {
    ...base,
    ...actions,
    ...tiers,
    additional_traits:   meta.additional_traits,
    corresponding_skill: meta.corresponding_skill,
    raw_fields,
    body_text:        meta.body_text,
    body_html:        meta.body_html,
    links:            meta.links,
    meta_description: meta.meta_description,
    meta_keywords:    meta.meta_keywords,
  } satisfies SkillOutputFields;
}

/**
 * Project a CommonExtraction of a Skills.aspx page into a typed SkillOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through the
 * decomposed skill extraction nodes.
 */
export function extractSkill(c: CommonExtraction, $: CheerioAPI, span: any): SkillOutputFields {
  const extractSkillBase = require('./base.js').extractSkillBase;
  const extractSkillActions = require('./actions.js').extractSkillActions;
  const extractSkillProficiencyTiers = require('./proficiency-tiers.js').extractSkillProficiencyTiers;

  const base    = extractSkillBase(c, $, span);
  const actions = extractSkillActions(c, $, span);
  const tiers   = extractSkillProficiencyTiers(c, $, span);
  const meta    = extractSkillMeta(c, $, span);
  return finalizeSkill(c, base, actions, tiers, meta);
}
