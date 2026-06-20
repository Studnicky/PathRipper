import { NodeStateBase } from '@studnicky/dagonizer';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';

import type { RipperConfigInterface, NormalizedRipperConfigInterface } from '../types/Config.js';

/**
 * State flowing through every node in the config-load DAG.
 *
 * @remarks
 * Extends `NodeStateBase` from `@studnicky/dagonizer` so the dispatcher can
 * manage the execution lifecycle, collect errors/warnings, and checkpoint the
 * state for resumable runs.
 *
 * Each field corresponds to one step in the load pipeline:
 * - `path`       set by the caller before dispatch (input)
 * - `raw`        set by `ReadFileNode`
 * - `parsed`     set by `ParseJsonNode`
 * - `validated`  set by `ValidateConfigSchemaNode`
 * - `normalized` set by `NormalizeCacheNode` (final output)
 *
 * @category State
 * @since 3.0.0
 */
export class ConfigLoadState extends NodeStateBase {
  /** Absolute path to the config file (input — set before dispatch). */
  path: string = '';

  /** Raw file contents string (populated by `ReadFileNode`). */
  raw: string = '';

  /** JSON-parsed object from `raw` (populated by `ParseJsonNode`). */
  parsed: unknown = undefined;

  /**
   * AJV-validated config object (populated by `ValidateConfigSchemaNode`).
   * `null` until validation succeeds.
   */
  validated: RipperConfigInterface | null = null;

  /**
   * Fully normalized config (populated by `NormalizeCacheNode`).
   * `null` until normalization succeeds. This is the final output.
   */
  normalized: NormalizedRipperConfigInterface | null = null;

  /**
   * Clone state for isolated execution (sub-flows and fan-out).
   */
  public override clone(): this {
    const cloned = new ConfigLoadState();
    for (const [key, value] of Object.entries(this.metadata)) {
      cloned.setMetadata(key, value);
    }
    cloned.path       = this.path;
    cloned.raw        = this.raw;
    cloned.parsed     = this.parsed;
    cloned.validated  = this.validated;
    cloned.normalized = this.normalized;
    return cloned as this;
  }

  /**
   * Snapshots domain-specific fields for `Checkpoint.from()`.
   * Called by the engine automatically; do not call directly.
   */
  protected override snapshotData(): JsonObjectType {
    return {
      path:       this.path,
      raw:        this.raw,
      parsed:     this.parsed as JsonObjectType | null,
      validated:  this.validated as unknown as JsonObjectType | null,
      normalized: this.normalized as unknown as JsonObjectType | null,
    };
  }

  /**
   * Restores domain-specific fields from a checkpoint snapshot.
   * Called by `Checkpoint.restore()`; do not call directly.
   */
  protected override restoreData(snap: JsonObjectType): void {
    const path = snap['path'];
    if (typeof path === 'string') this.path = path;

    const raw = snap['raw'];
    if (typeof raw === 'string') this.raw = raw;

    if ('parsed' in snap) this.parsed = snap['parsed'];

    const validated = snap['validated'];
    if (validated !== null && typeof validated === 'object' && !Array.isArray(validated)) {
      this.validated = validated as unknown as RipperConfigInterface;
    } else {
      this.validated = null;
    }

    const normalized = snap['normalized'];
    if (normalized !== null && typeof normalized === 'object' && !Array.isArray(normalized)) {
      this.normalized = normalized as unknown as NormalizedRipperConfigInterface;
    } else {
      this.normalized = null;
    }
  }
}
