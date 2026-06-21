import type { BaseShape, SourceShape } from '../_helpers.js';
import type { Rarity, PfsLegality, SourceRef } from '../../common.js';

export interface HazardComponent {
  component: string;
  value:     number;
  notes:     string | null;
  bt:        number | null;
}

export interface HazardRoutine {
  name:         string;
  trigger:      string | null;
  effect:       string;
  actions:      string | null;
}

export interface HazardOutput extends BaseShape {
  /** Numeric AON hazard ID from the URL query string. */
  hazard_id:    number | null;
  level:        number | null;
  complexity:   'simple' | 'complex' | null;
  stealth:      { dc: number | null; notes: string | null; raw: string | null };
  description_text: string | null;
  disable:      Array<{ skill: string; dc: number | null; text: string }>;
  defenses: {
    ac:          number | null;
    saves:       { fort: number | null; ref: number | null; will: number | null };
    hardness:    HazardComponent[];
    hp:          HazardComponent[];
    immunities:  string[];
    weaknesses:  Array<{ type: string; value: number }>;
    resistances: Array<{ type: string; value: number; exceptions: string | null }>;
  };
  routines:     HazardRoutine[];
  reset:        string | null;
}

/** Fields owned by `extract-hazard-base`. */
export interface HazardBaseSlice {
  url:             string;
  hazard_id:       number | null;
  name:            string;
  level:           number | null;
  rarity:          Rarity;
  pfs:             PfsLegality | null;
  legacy:          boolean;
  alt_edition_url: string | null;
  traits:          string[];
  trait_ids:       Record<string, number>;
  source:          SourceShape;
  sources:         SourceRef[];
  complexity:      'simple' | 'complex' | null;
  stealth:         { dc: number | null; notes: string | null; raw: string | null };
  description_text: string | null;
}

/** Fields owned by `extract-hazard-defenses`. */
export interface HazardDefensesSlice {
  defenses: HazardOutput['defenses'];
}

/** Fields owned by `extract-hazard-routines`. */
export interface HazardRoutinesSlice {
  routines: HazardRoutine[];
  disable:  Array<{ skill: string; dc: number | null; text: string }>;
}

/** Fields owned by `extract-hazard-reset`. */
export interface HazardResetSlice {
  reset: string | null;
}
