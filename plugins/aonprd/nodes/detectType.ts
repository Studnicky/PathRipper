// Node: aonprd:detect-type
// Reads state.page.url, calls detectPageType(), and routes to the matching
// per-type extractor node. deity/archetype route to extract-generic.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import type { ScrapeState }  from '../../../src/state/ScrapeState.js';
import type { RipperServices }  from '../../../src/services/RipperServices.js';
import { detectPageType }    from '../common.js';

export type DetectTypeOutput =
  | 'spell'
  | 'monster'
  | 'feat'
  | 'weapon'
  | 'armor'
  | 'equipment'
  | 'action'
  | 'ancestry'
  | 'class'
  | 'background'
  | 'condition'
  | 'trait'
  | 'hazard'
  | 'generic'
  | 'unknown';

export const detectTypeNode: NodeInterface<ScrapeState, DetectTypeOutput, RipperServices> = {
  name: 'aonprd:detect-type',
  outputs: [
    'spell', 'monster', 'feat', 'weapon', 'armor', 'equipment',
    'action', 'ancestry', 'class', 'background', 'condition',
    'trait', 'hazard', 'generic', 'unknown',
  ],

  async execute(
    state:    ScrapeState,
    _context: NodeContextInterface<RipperServices>,
  ): Promise<{ output: DetectTypeOutput }> {
    const url  = state.page.url;
    const type = detectPageType(url);

    switch (type) {
      case 'spell':
      case 'ritual':     return { output: 'spell' };
      case 'monster':    return { output: 'monster' };
      case 'feat':       return { output: 'feat' };
      case 'weapon':     return { output: 'weapon' };
      case 'armor':
      case 'shield':     return { output: 'armor' };
      case 'equipment':  return { output: 'equipment' };
      case 'action':     return { output: 'action' };
      case 'ancestry':   return { output: 'ancestry' };
      case 'class':      return { output: 'class' };
      case 'background': return { output: 'background' };
      case 'condition':  return { output: 'condition' };
      case 'trait':      return { output: 'trait' };
      case 'hazard':     return { output: 'hazard' };
      case 'deity':
      case 'archetype':
      case 'generic':    return { output: 'generic' };
      case 'unknown':    return { output: 'unknown' };
    }
  },
};

/** OperationContract for detectTypeNode: reads page.url, routes only (no state write). */
export const detectTypeContract: OperationContract = {
  name:         'aonprd:detect-type',
  hardRequired: ['page.url'],
  produces:     [],
  outputs:      [
    'spell', 'monster', 'feat', 'weapon', 'armor', 'equipment',
    'action', 'ancestry', 'class', 'background', 'condition',
    'trait', 'hazard', 'generic', 'unknown',
  ],
};
