// Skill concept — finalize and meta slice extraction.
import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction } from '../../common.js';
import { htmlToText, harvestLinks, extractMetaDescription, extractMetaKeywords, stripStructuredKeys } from '../../common.js';
import { extractSkillBase } from './base.js';
import { extractSkillActions } from './actions.js';
import { extractSkillProficiencyTiers } from './proficiency-tiers.js';
import type { SkillOutput, SkillBaseSlice, SkillActionsSlice, SkillProficiencyTiersSlice, SkillMetaSlice } from './types.js';
import { CLAIMED_FIELD_LABELS } from './types.js';

/** Extract whole-page link / body / meta projection. */
export function extractSkillMeta(common: CommonExtraction, root: CheerioAPI, span: unknown): SkillMetaSlice {
  // Skill pages have no top-level `<hr/>` separator, so `common.body_html` is cut
  // at the first `<hr/>` inside the first action (typically Balance) and only
  // contains the tail of the page. Use the full content span instead so the
  // body / link harvest covers every action on the page.
  const spanHtml = (span as { html(): string | null }).html() ?? '';

  // Lift rare metadata blocks. Both labels are simple <b>Label</b> Value<br/>
  // pairs in the head section.
  const addRaw = common.field_map['Additional Traits'];
  const additional_traits: string[] = addRaw === undefined
    ? []
    : addRaw.split(',').map((str) => str.trim()).filter((str) => str !== '');

  let corresponding_skill: { name: string; skill_id: number | null } | null = null;
  const corrRaw = common.field_map['Corresponding Skill'];
  if (corrRaw !== undefined) {
    const name = corrRaw.trim();
    if (name !== '') {
      const link = common.links.find((entry) => entry.kind === 'Skills' && entry.text === name);
      corresponding_skill = { name, skill_id: link?.id ?? null };
    }
  }

  return {
    additional_traits,
    corresponding_skill,
    body_text:        htmlToText(spanHtml),
    body_html:        spanHtml,
    links:            harvestLinks(spanHtml),
    meta_description: extractMetaDescription(root),
    meta_keywords:    extractMetaKeywords(root),
  };
}

/**
 * Assemble the final SkillOutput from per-slice results.
 *
 * Computes `raw_fields` by stripping every AON label claimed by upstream slices
 * (CLAIMED_FIELD_LABELS). For most skills `common.field_map` is empty (the only
 * head-section bold label is `<b>Source</b>`, which `harvestFields` drops), so
 * `raw_fields` ends up as `{}`.
 */
export function finalizeSkill(
  common:   CommonExtraction,
  base:     SkillBaseSlice,
  actions:  SkillActionsSlice,
  tiers:    SkillProficiencyTiersSlice,
  meta:     SkillMetaSlice,
): SkillOutput {
  const raw_fields = stripStructuredKeys(common.field_map, CLAIMED_FIELD_LABELS);

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
  } satisfies SkillOutput;
}

/**
 * Project a CommonExtraction of a Skills.aspx page into a typed SkillOutput.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through the
 * decomposed skill extraction nodes.
 */
export function extractSkill(common: CommonExtraction, root: CheerioAPI, span: unknown): SkillOutput {
  const base    = extractSkillBase(common, root, span);
  const actions = extractSkillActions(common, root, span);
  const tiers   = extractSkillProficiencyTiers(common, root, span);
  const meta    = extractSkillMeta(common, root, span);
  return finalizeSkill(common, base, actions, tiers, meta);
}
