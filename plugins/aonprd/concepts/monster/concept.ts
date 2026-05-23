/**
 * Monster concept declaration.
 *
 * Imported by `plugins/aonprd/taxonomy/aonprd.ts`.
 * The five extract nodes run in order: base → defenses → offense → abilities → meta,
 * building up state.output incrementally. The finalize node recomputes the full
 * output from scratch so raw_fields can see the complete picture of claimed labels.
 */
import type { ConceptDecl } from '../../taxonomy.js';
import type { MonsterOutput } from './types.js';
import { monsterBaseNode } from './base.js';
import { monsterDefensesNode } from './defenses.js';
import { monsterOffenseNode } from './offense.js';
import { monsterAbilitiesNode } from './abilities.js';
import { monsterMetaNode } from './meta.js';
import { finalizeMonsterNode } from './finalize.js';

export type { MonsterOutput } from './types.js';

export const monsterConcept: ConceptDecl<MonsterOutput> = {
  id:       'monster',
  parent:   'entity',
  urlPaths: ['monsters', 'creatures', 'npcs'],
  capabilities: [
    monsterBaseNode,
    monsterDefensesNode,
    monsterOffenseNode,
    monsterAbilitiesNode,
    monsterMetaNode,
    finalizeMonsterNode,
  ],
  discriminator: { _type: 'monster' },
};
