import { NodeStateBase } from '@noocodex/dagonizer';
import type { JsonObject } from '@noocodex/dagonizer/entities';

import type { NormalizedRipperConfigInterface } from '../types/Config.js';

/**
 * Valid CLI command names — matches the commander commands registered in cli.ts.
 *
 * @category State
 * @since 3.1.0
 */
export type CliCommandType = 'scrape' | 'scrape-html' | 'scrape-wiki' | 'crawl';

/**
 * State flowing through every node in the CLI dispatch DAG.
 *
 * @remarks
 * Extends `NodeStateBase` from `@noocodex/dagonizer` so the dispatcher can
 * manage the execution lifecycle, collect errors/warnings, and checkpoint the
 * state for resumable runs.
 *
 * - `argv`        optional — carries raw args for programmatic dispatch; main path uses commander.
 * - `command`     the parsed CLI command name.
 * - `options`     parsed flag bag from commander.
 * - `configPath`  path to the ripperoni config file.
 * - `config`      loaded + normalized config; `null` until `LoadConfigNode` succeeds.
 * - `targetId`    the `--target` flag value.
 * - `targetKind`  `'html'` or `'wiki'`; resolved by `ResolveTargetNode`; `null` until then.
 * - `outDir`      resolved output directory.
 * - `exitCode`    set by terminal nodes; 0 success, non-zero failure.
 *
 * @category State
 * @since 3.1.0
 */
export class CliState extends NodeStateBase {
  /** Optional raw argv for programmatic dispatch. Not set in normal CLI flows. */
  argv: string[] = [];

  /** Parsed CLI command name. */
  command: CliCommandType = 'scrape';

  /** Parsed flag bag from commander. */
  options: Record<string, unknown> = {};

  /** Path to the ripperoni config file. */
  configPath: string = '';

  /** Loaded + normalized config. `null` until `LoadConfigNode` succeeds. */
  config: NormalizedRipperConfigInterface | null = null;

  /** The `--target` flag value. */
  targetId: string = '';

  /** Resolved target kind. `null` until `ResolveTargetNode` runs. */
  targetKind: 'html' | 'wiki' | null = null;

  /** Resolved output directory. */
  outDir: string = '';

  /**
   * Process exit code. Set by `ExitNode` based on upstream outcome.
   * 0 = success, 1 = general failure, 2 = partial failure.
   */
  exitCode: number = 0;

  /**
   * Error message captured from failed nodes, e.g. config load or target resolution.
   * Written by nodes on failure paths; read by `ExitNode`.
   */
  errorMessage: string = '';

  /**
   * Number of pages that failed after retry.
   * Written by dispatch nodes; read by `WriteManifestNode` and `ExitNode`.
   */
  failedCount: number = 0;

  /**
   * Clone state for isolated execution (sub-flows and fan-out).
   */
  public override clone(): CliState {
    const cloned = new CliState();
    for (const [key, value] of Object.entries(this.metadata)) {
      cloned.setMetadata(key, value);
    }
    cloned.argv         = [...this.argv];
    cloned.command      = this.command;
    cloned.options      = { ...this.options };
    cloned.configPath   = this.configPath;
    cloned.config       = this.config;
    cloned.targetId     = this.targetId;
    cloned.targetKind   = this.targetKind;
    cloned.outDir       = this.outDir;
    cloned.exitCode     = this.exitCode;
    cloned.errorMessage = this.errorMessage;
    cloned.failedCount  = this.failedCount;
    return cloned;
  }

  /**
   * Snapshots domain-specific fields for `Checkpoint.from()`.
   * Called by the engine automatically; do not call directly.
   */
  protected override snapshotData(): JsonObject {
    return {
      argv:         [...this.argv],
      command:      this.command,
      options:      this.options as JsonObject,
      configPath:   this.configPath,
      config:       this.config as unknown as JsonObject | null,
      targetId:     this.targetId,
      targetKind:   this.targetKind,
      outDir:       this.outDir,
      exitCode:     this.exitCode,
      errorMessage: this.errorMessage,
      failedCount:  this.failedCount,
    };
  }

  /**
   * Restores domain-specific fields from a checkpoint snapshot.
   * Called by `Checkpoint.restore()`; do not call directly.
   */
  protected override restoreData(snap: JsonObject): void {
    const argv = snap['argv'];
    if (Array.isArray(argv)) this.argv = argv as string[];

    const command = snap['command'];
    if (typeof command === 'string') this.command = command as CliCommandType;

    const options = snap['options'];
    if (options !== null && typeof options === 'object' && !Array.isArray(options)) {
      this.options = options as Record<string, unknown>;
    }

    const configPath = snap['configPath'];
    if (typeof configPath === 'string') this.configPath = configPath;

    const config = snap['config'];
    if (config !== null && typeof config === 'object' && !Array.isArray(config)) {
      this.config = config as unknown as NormalizedRipperConfigInterface;
    } else {
      this.config = null;
    }

    const targetId = snap['targetId'];
    if (typeof targetId === 'string') this.targetId = targetId;

    const targetKind = snap['targetKind'];
    if (targetKind === 'html' || targetKind === 'wiki') {
      this.targetKind = targetKind;
    } else {
      this.targetKind = null;
    }

    const outDir = snap['outDir'];
    if (typeof outDir === 'string') this.outDir = outDir;

    const exitCode = snap['exitCode'];
    if (typeof exitCode === 'number') this.exitCode = exitCode;

    const errorMessage = snap['errorMessage'];
    if (typeof errorMessage === 'string') this.errorMessage = errorMessage;

    const failedCount = snap['failedCount'];
    if (typeof failedCount === 'number') this.failedCount = failedCount;
  }
}
