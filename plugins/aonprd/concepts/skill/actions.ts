// Skill concept — actions slice extraction.
import type { CheerioAPI } from 'cheerio';
import type { CommonExtraction } from '../../common.js';
import { parseActions } from './helpers.js';
import type { SkillActionsSlice } from './types.js';

/** Extract every `<h2 class="title">` action block under the skill page. */
export function extractSkillActions(_common: CommonExtraction, root: CheerioAPI, span: unknown): SkillActionsSlice {
  void _common;
  return { actions: parseActions(root, span) };
}
