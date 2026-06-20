/**
 * Ritual concept declaration.
 *
 * Rituals share the spell HTML structure; `kind` resolves to `'ritual'`
 * automatically via `resolveKind()` in the extraction helpers. The ritual concept
 * uses distinct node names (extract:ritual-* / finalize:ritual) so the taxonomy
 * compiler can register both ritual and spell chains without name collision.
 *
 * Mythic rituals share the same structure; `mythicrituals` is included in
 * urlPaths so they route here.
 */
import type { ConceptDecl } from '../../taxonomy.js';
import { ritualBaseNode } from './base.js';
import { ritualCastNode, ritualOutcomesNode, ritualAfflictionNode, ritualHeightenedNode, ritualMetaNode } from './slices.js';
import { finalizeRitualNode } from './finalize.js';
import type { RitualOutput } from './types.js';

export const ritualConcept: ConceptDecl<RitualOutput> = {
  id:       'ritual',
  parent:   'entity',
  urlPaths: ['rituals', 'mythicrituals'],
  capabilities: [
    ritualBaseNode,
    ritualCastNode,
    ritualOutcomesNode,
    ritualAfflictionNode,
    ritualHeightenedNode,
    ritualMetaNode,
    finalizeRitualNode,
  ],
};
