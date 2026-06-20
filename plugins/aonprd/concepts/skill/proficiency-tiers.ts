// Skill concept — proficiency tiers slice extraction.
import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction } from '../../common.js';
import { parseProficiencyTiers } from './helpers.js';
import type { SkillProficiencyTiersSlice } from './types.js';

/** Extract Sample-Tasks tier descriptions (empty when none are present). */
export function extractSkillProficiencyTiers(
  _common: CommonExtraction,
  root:    CheerioAPI,
  span:    unknown,
): SkillProficiencyTiersSlice {
  void _common;
  return { proficiency_tiers: parseProficiencyTiers(root, span) };
}
