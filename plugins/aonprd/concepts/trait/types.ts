import type { BaseShape, SourceShape } from '../_helpers.js';
import type { Rarity, PfsLegality, SourceRef } from '../../common.js';

export interface TraitOutput extends BaseShape {
  /** Numeric AON trait ID from the URL query string. */
  trait_id: number | null;
  category: string | null;
}

/** Fields owned by `extract-trait-base`. */
export interface TraitBaseSlice {
  url:             string;
  trait_id:        number | null;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          SourceShape;
  sources:         SourceRef[];
}
