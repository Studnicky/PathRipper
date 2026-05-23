/**
 * Spell concept declaration.
 *
 * Defines the spell concept for the AONPRD taxonomy. The six extract nodes run
 * in order — base → cast → outcomes → affliction → heightened → meta — building
 * up state.output incrementally. The finalize node then recomputes the full output
 * from scratch so that raw_fields can see the complete picture of claimed labels.
 *
 * Mythic spells share the same HTML structure as regular spells; `mythicspells`
 * is included in urlPaths so they route here.
 */
import type { CheerioAPI } from 'cheerio';

import type { ConceptDecl } from '../../taxonomy.js';
import type { CommonExtraction, CheerioNode } from '../../common.js';

import type { SpellOutput } from './types.js';
import { spellBaseNode } from './base.js';
import { spellCastNode } from './cast.js';
import { spellOutcomesNode } from './outcomes.js';
import { spellAfflictionNode } from './affliction.js';
import { spellHeightenedNode } from './heightened.js';
import { spellMetaNode } from './meta.js';
import { finalizeSpellNode } from './finalize.js';
import { extractSpellBase } from './base.js';
import { extractSpellCast } from './cast.js';
import { extractSpellOutcomes } from './outcomes.js';
import { extractSpellAffliction } from './affliction.js';
import { extractSpellHeightened } from './heightened.js';
import { extractSpellMeta } from './meta.js';
import { finalizeSpell } from './finalize.js';

/**
 * Build a SpellOutput from the shared extraction surface — never throws.
 *
 * Thin assembly wrapper kept for `parseAonHtml` direct-call paths and unit
 * tests. The DAG pipeline calls the per-slice helpers individually through
 * the decomposed spell extraction nodes.
 */
export function extractSpell(c: CommonExtraction, $: CheerioAPI, span: CheerioNode): SpellOutput {
  const base       = extractSpellBase(c, $, span);
  const cast       = extractSpellCast(c);
  const outcomes   = extractSpellOutcomes(c);
  const affliction = extractSpellAffliction(c);
  const heightened = extractSpellHeightened(c);
  const meta       = extractSpellMeta(c, $);
  return finalizeSpell(c, base, cast, outcomes, affliction, heightened, meta, $, span);
}

export const spellConcept: ConceptDecl<SpellOutput> = {
  id:       'spell',
  parent:   'entity',
  urlPaths: ['spells', 'mythicspells'],
  capabilities: [
    spellBaseNode,
    spellCastNode,
    spellOutcomesNode,
    spellAfflictionNode,
    spellHeightenedNode,
    spellMetaNode,
    finalizeSpellNode,
  ],
  discriminator: { _type: 'spell' },
};
