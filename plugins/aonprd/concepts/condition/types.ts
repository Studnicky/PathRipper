import type { BaseShape, SourceShape } from '../_helpers.js';
import type { Rarity, PfsLegality, SourceRef } from '../../common.js';

export interface ConditionStage {
  stage:     number;
  text:      string;
  duration:  string | null;
}

export interface ConditionOutput extends BaseShape {
  /** Numeric AON condition ID extracted from the URL query string. */
  condition_id: number | null;
  stages:   ConditionStage[];
  /** Other conditions referenced from the body. */
  related_conditions: Array<{ name: string; condition_id: number | null }>;
}

/** Fields owned by `extract-condition-base`. */
export interface ConditionBaseSlice {
  url:             string;
  condition_id:    number | null;
  name:            string;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          SourceShape;
  sources:         SourceRef[];
  /** Level for level-bearing conditions (most have none). */
  level:           number | null;
}

/** Fields owned by `extract-condition-stages`. */
export interface ConditionStagesSlice {
  stages:             ConditionStage[];
  related_conditions: Array<{ name: string; condition_id: number | null }>;
}
