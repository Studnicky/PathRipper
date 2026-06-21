/**
 * Skill concept — public exports.
 */
export { skillConcept } from './concept.js';
export type { SkillOutput } from './types.js';
export { skillBaseNode } from './concept.js';
export { skillActionsNode } from './concept.js';
export { skillProficiencyTiersNode } from './concept.js';
export { finalizeSkillNode } from './concept.js';
// Re-export for tests that import directly
export { extractSkill } from './finalize.js';
export type {
  SkillBaseOutput,
  SkillActionsOutput,
  SkillProficiencyTiersOutput,
  FinalizeSkillOutput,
} from './concept.js';
