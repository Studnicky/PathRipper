/**
 * Equipment concept — private type declarations for internal helpers only.
 */
import type { Activation as PublicActivation } from './types.js';

export interface PriceParts {
  gp: number | null; sp: number | null; cp: number | null; raw: string | null;
}

export interface DamageParts {
  dice: string; type: 'B' | 'P' | 'S' | null; rider: string | null;
}

export type Activation = PublicActivation;
