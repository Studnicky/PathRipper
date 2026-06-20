// Capability: extract:saving-throw
// Reads `aonprdCommon` and parses the `Saving Throw` field into a structured
// shape: `{ dc: number | null, save: string | null, basic: boolean }`.
//
// Used by: spell/affliction, ritual, curse, disease concepts that carry
// saving throw mechanics.
//
// Pattern: soft-fail to 'success' with no writes when aonprdCommon is absent
// or the Saving Throw field is missing. This is a pure parse + side-write
// capability (open-world convention: produces = []).
//
// Lifted into a shared capability to eliminate duplicate parsers across concept files.
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';

import type { ScrapeState } from '../../../src/state/ScrapeState.js';
import type { CommonExtraction } from '../common.js';
import { getField } from '../common.js';

/** Saving Throw breakdown — DC + save name + basic flag. */
export interface SavingThrow {
  /** DC value when present (`DC 28 Will` → 28). */
  dc: number | null;
  /** Save name when present (`Will`, `Fortitude`, `Reflex`). */
  save: string | null;
  /** True when the throw is prefixed with `basic`. */
  basic: boolean;
}

/**
 * Parse a `Saving Throw` value into structured DC + save + basic flag.
 *
 * AON renders these as `DC 28 Will`, `Fortitude`, or `basic Reflex`. The DC and
 * save name are both optional; when either is absent, the parsed field is null
 * but basic is always a boolean.
 *
 * Returns null when input is null or empty.
 */
export function parseSavingThrow(text: string | null): SavingThrow | null {
  if (text === null) return null;
  const trimmed = text.trim();
  if (trimmed === '') return null;

  const basic = /^basic\b/i.test(trimmed);
  const stripped = basic ? trimmed.replace(/^basic\s+/i, '').trim() : trimmed;

  const dcMatch = /DC\s*(\d+)/i.exec(stripped);
  const dcVal = dcMatch !== null ? parseInt(dcMatch[1]!, 10) : null;

  // Only remove the DC pattern if we successfully matched and parsed it.
  let remainder = stripped;
  if (dcMatch !== null) {
    remainder = stripped.replace(/DC\s*\d+\s*/i, '').trim();
  }
  const save = remainder === '' ? null : remainder;

  return { dc: dcVal, save, basic };
}

export type SavingThrowOutput = 'success';

class SavingThrowNodeImpl extends ScalarNode<ScrapeState, SavingThrowOutput> {
  public readonly name    = 'extract:saving-throw';
  public readonly outputs = ['success'] as const;

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<SavingThrowOutput>> {
    const common = state.getMetadata<CommonExtraction>('aonprdCommon');
    if (common === undefined) return NodeOutputBuilder.of('success');

    const raw = getField(common, 'Saving Throw');
    if (raw === null) return NodeOutputBuilder.of('success');

    const savingThrow = parseSavingThrow(raw);
    if (savingThrow !== null) {
      state.setMetadata('aonprdSavingThrow', savingThrow);
    }

    return NodeOutputBuilder.of('success');
  }
}
export const savingThrowNode = new SavingThrowNodeImpl();
