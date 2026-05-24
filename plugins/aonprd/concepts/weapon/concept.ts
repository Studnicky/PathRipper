/**
 * Weapon concept declaration and extraction nodes.
 *
 * Imported by `plugins/aonprd/taxonomy/aonprd.ts`.
 * The base and mechanics nodes run in order, building up state.output incrementally.
 * The finalize node recomputes the full output from scratch so raw_fields can see
 * the complete picture of claimed labels.
 */
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';

import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';
import type { ConceptDecl } from '../../taxonomy.js';
import type { CommonExtraction } from '../../common.js';
import { CAPABILITY_OUTPUTS } from '../../common.js';
import type { WeaponOutput } from './types.js';
import { extractWeaponBase } from './base.js';
import { extractWeaponMechanics } from './mechanics.js';
import { finalizeWeaponNode } from './finalize.js';

export type { WeaponOutput } from './types.js';

export type WeaponBaseOutput = 'success' | 'error';

export const weaponBaseNode: NodeInterface<ScrapeState, WeaponBaseOutput, RipperServices> = {
  name:    'extract:weapon-base',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: WeaponBaseOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const base = extractWeaponBase(c);

    state.output = { ...state.output, ...base };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type WeaponMechanicsOutput = 'success' | 'error';

export const weaponMechanicsNode: NodeInterface<ScrapeState, WeaponMechanicsOutput, RipperServices> = {
  name:    'extract:weapon-mechanics',
  outputs: CAPABILITY_OUTPUTS,
  contract: {
    hardRequired: ['aonprdCommon'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,

  async execute(
    state: ScrapeState,
    _ctx:  NodeContextInterface<RipperServices>,
  ): Promise<{ output: WeaponMechanicsOutput }> {
    const c = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (c === undefined) return { output: 'error' };

    const mechanics = extractWeaponMechanics(c);

    state.output = { ...state.output, ...mechanics };

    return { output: 'success' };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const weaponConcept: ConceptDecl<WeaponOutput> = {
  id:       'weapon',
  parent:   'entity',
  urlPaths: ['weapons'],
  capabilities: [
    weaponBaseNode,
    weaponMechanicsNode,
    finalizeWeaponNode,
  ],
};
