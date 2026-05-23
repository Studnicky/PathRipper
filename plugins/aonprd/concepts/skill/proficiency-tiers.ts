// Skill concept — proficiency tiers slice extraction.
import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction } from '../../common.js';
import { parseProficiencyTiers } from './helpers.js';
import type { SkillProficiencyTiersSlice } from './types.js';

/** Extract Sample-Tasks tier descriptions (empty when none are present). */
export function extractSkillProficiencyTiers(
  _c:    CommonExtraction,
  $:     CheerioAPI,
  span:  any,
): SkillProficiencyTiersSlice {
  void _c;
  return { proficiency_tiers: parseProficiencyTiers($, span) };
}
