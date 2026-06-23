/**
 * Equipment concept — taxonomy declaration.
 *
 * Exports: equipmentConcept.
 */
import type { ConceptDecl } from '../../../../src/taxonomy/Taxonomy.js';
import type { EquipmentOutput } from './types.js';
import {
  equipmentBaseNode,
  equipmentMechanicsNode,
  finalizeEquipmentNode,
} from './finalize.js';

export const equipmentConcept: ConceptDecl<EquipmentOutput> = {
  id:       'equipment',
  parent:   'entity',
  urlPaths: ['equipment'],
  capabilities: [
    equipmentBaseNode,
    equipmentMechanicsNode,
    finalizeEquipmentNode,
  ],
};
