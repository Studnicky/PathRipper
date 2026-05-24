import type { BaseShape, SourceShape } from '../_helpers.js';
import type { Rarity, PfsLegality, SourceRef } from '../../common.js';
import type { ConceptOutputBase } from '../../taxonomy.js';

export interface TraitOutputFields extends BaseShape {
  /** Numeric AON trait ID from the URL query string. */
  trait_id: number | null;
  category: string | null;
}

/** Full output shape — `_type` discriminator stamped by the router at chain entry. */
export type TraitOutput = ConceptOutputBase<'trait'> & TraitOutputFields;

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
