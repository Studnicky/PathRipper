// extract:deity-edicts-anathema slice — edicts, anathema, areas of concern, etc.

import type { CommonExtraction } from '../../common.js';
import {
  harvestLinkedBoldLabels,
  parseLinkedList,
} from './helpers.js';
import type { DeityEdictsAnathemaSlice } from './types.js';

export function extractDeityEdictsAnathema(c: CommonExtraction): DeityEdictsAnathemaSlice {
  // Cut the body at the first `<h2 class="title">` to isolate the pre-section
  // header fragment carrying Category / Edicts / Anathema / etc.
  const cut = /<h2\b[^>]*class="[^"]*title[^"]*"[^>]*>/i.exec(c.body_html);
  const headFragment = cut !== null ? c.body_html.slice(0, cut.index) : c.body_html;
  const map = harvestLinkedBoldLabels(headFragment);
  return {
    category:            map.get('category')             ?? null,
    edicts:              map.get('edicts')               ?? null,
    anathema:            map.get('anathema')             ?? null,
    areas_of_concern:    map.get('areas of concern')     ?? null,
    follower_alignments: map.get('follower alignments')  ?? null,
    religious_symbol:    map.get('religious symbol')     ?? null,
    sacred_animal:       map.get('sacred animal')        ?? null,
    sacred_colors:       map.get('sacred color(s)')      ?? map.get('sacred colors') ?? null,
    pantheons_covenants: parseLinkedList(map.get('pantheons/covenants') ?? map.get('pantheons') ?? null),
  };
}
