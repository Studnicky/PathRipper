// Plugin DAG: dnd5e:parse.
//
// Built from the compiled dnd5e taxonomy via DAGBuilder.
import type { DAGType } from '@studnicky/dagonizer';

import { TAXONOMY } from './taxonomy/dnd5e.js';

export const dnd5eParseDAG: DAGType = TAXONOMY.buildDAG('dnd5e:parse', '1.0');
