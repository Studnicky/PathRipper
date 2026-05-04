/**
 * @fileoverview `SquashageOrchestrator` — run-wide context construction, per-record
 * pipeline dispatch, and drain-then-finalize lifecycle for Squashage v0.x.
 *
 * @remarks
 * The orchestrator follows the pipeline lifecycle established by plan 13
 * (§"Pipeline Lifecycle: Orchestrator-Driven Finalize"). It:
 *
 * 1. Resolves the target config and applies CLI overrides.
 * 2. Constructs the run-wide {@link PipelineContextInterface} (factory, dataset,
 *    builder, graphs, iri, output).
 * 3. Strips `rdfjs:finalize` from the per-record pipeline so the finalize task
 *    never runs inside a per-record `ConcurrentPipeline` execution.
 * 4. Walks the input source (single `.json`, single `.jsonl`, or a directory
 *    that is recursively walked for `.json` and `.jsonl` files) and builds one
 *    {@link PipelineStateInterface} per record, each carrying its own augmented
 *    context with `config.recordPath` / `config.recordLine` so `json:read` can
 *    locate the record on disk.
 * 5. Drives per-record execution via {@link ConcurrentPipeline.executeAll}.
 * 6. After the per-record batch settles, invokes the finalize task once with a
 *    synthetic state carrying the run-wide context.
 * 7. Computes and returns the {@link RunResultInterface}.
 *
 * The module `'../tasks/index.js'` is imported once at the top so the global
 * {@link TaskRegistry} is populated with all built-in tasks before any pipeline
 * is assembled.
 *
 * @module orchestrators/SquashageOrchestrator
 * @category Orchestrator
 * @since 0.1.0
 */

import { readdir, stat, readFile } from 'node:fs/promises';
import { join, extname }           from 'node:path';

// Bootstrap built-in task registrations (json:read, rdfjs:finalize).
import '../tasks/index.js';

import type { SquashageConfigInterface, TargetConfigInterface } from '../config/SquashageConfig.js';
import type { OutputConfigInterface }      from '../config/OutputConfig.js';
import type { PipelineStateInterface, PipelineContextInterface } from '../types/PipelineState.js';

import { Pipeline }            from '../pipeline/Pipeline.js';
import { ConcurrentPipeline }  from '../pipeline/ConcurrentPipeline.js';
import { PipelineState }       from '../registry/PipelineState.js';
import { TaskRegistry }        from '../registry/TaskRegistry.js';
import { SquashageConfigError } from '../errors/SquashageConfigError.js';
import { dataFactory }         from '../rdf/DataFactory.js';
import { Dataset }             from '../rdf/Dataset.js';
import { GraphBuilder }        from '../rdf/GraphBuilder.js';
import { Namespaces }          from '../rdf/Namespaces.js';
import { QuarantineWriter }    from '../quarantine/QuarantineWriter.js';
import { Logger }              from '../modules/logger/logger.js';

const logger = Logger.forComponent('SquashageOrchestrator');

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/**
 * The aggregate result of a single Squashage target run.
 *
 * @remarks
 * Returned by {@link SquashageOrchestrator.run} after the finalize phase
 * completes. The {@link exitCode} follows the same semantics as the CLI exit
 * code: `0` for a clean run, `1` for quarantine failures, `2` is reserved for
 * pre-run config errors thrown before this object is produced.
 *
 * @category Orchestrator
 * @since 0.1.0
 * @see {@link SquashageOrchestrator}
 * @group Types
 */
export interface RunResultInterface {
  /** Target identifier from the squashage config. */
  readonly target:      string;
  /** Total number of input records discovered during the walk phase. */
  readonly recordCount: number;
  /** Number of records that completed the per-record pipeline without throwing. */
  readonly succeeded:   number;
  /** Number of records that caused the per-record pipeline to throw. */
  readonly failed:      number;
  /** Quarantine bucket counts collected by {@link QuarantineWriter}. */
  readonly quarantine:  { unknown: number; conflicts: number; projection: number; output: number };
  /** Resolved output file path (from the synthesized output config). */
  readonly outputPath:  string;
  /** Process exit code for this run. */
  readonly exitCode:    0 | 1 | 2;
}

/**
 * Options for a single {@link SquashageOrchestrator.run} invocation.
 *
 * @remarks
 * CLI-supplied flags map directly to these options. Each field overrides the
 * corresponding field in the target's config without mutating it.
 *
 * @category Orchestrator
 * @since 0.1.0
 * @see {@link SquashageOrchestrator}
 * @group Types
 */
export interface RunOptionsInterface {
  /** Override the resolved `output.path` from the target config. */
  readonly outOverride?:    string | undefined;
  /** Override the resolved `output.format` from the target config. */
  readonly formatOverride?: string | undefined;
  /** When `true`, {@link FileOutput} computes the report but does not write the file. */
  readonly dryRun?:         boolean | undefined;
  /** Override the input directory/file path (default: `targetConfig.input`). */
  readonly inputOverride?:  string | undefined;
  /** Output base directory for reports and quarantine artifacts (default: `'./graphs'`). */
  readonly outDir?:         string | undefined;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** A `{ recordPath, recordLine }` pair identifying one input record on disk. */
interface RecordLocatorInterface {
  /** Absolute or relative path to the file that contains this record. */
  readonly recordPath: string;
  /** 0-based line index within a JSONL file; always `0` for plain JSON files. */
  readonly recordLine: number;
}

// ---------------------------------------------------------------------------
// SquashageOrchestrator
// ---------------------------------------------------------------------------

/**
 * Static-only orchestrator that drives a full Squashage target run.
 *
 * @remarks
 * All methods are static; the class cannot be instantiated. Each call to
 * {@link SquashageOrchestrator.run} is fully isolated — it constructs its own
 * run-wide context, pipeline, and quarantine writer.
 *
 * **Lifecycle** (per plan 13 §"Pipeline Lifecycle: Orchestrator-Driven Finalize"):
 *
 * 1. Validate target exists in `config.targets`.
 * 2. Apply CLI overrides to a synthesized {@link OutputConfigInterface}.
 * 3. Construct the run-wide {@link PipelineContextInterface}.
 * 4. Strip `rdfjs:finalize` from the per-record task list; hold a reference.
 * 5. Build a {@link Pipeline} from the remaining per-record tasks.
 * 6. Walk the input source to produce `RecordLocatorInterface[]`.
 * 7. Build one {@link PipelineStateInterface} per record, each augmented with
 *    `config.recordPath` / `config.recordLine`.
 * 8. Execute via {@link ConcurrentPipeline.executeAll}.
 * 9. Invoke the finalize task once with a synthetic state carrying `ctx`.
 * 10. Return the {@link RunResultInterface}.
 *
 * @example
 * ```ts
 * const config = SquashageConfig.loadFromFile('./squashage.config.json');
 * const result = await SquashageOrchestrator.run(config, 'bulbapedia', {
 *   outOverride: './graphs/bulbapedia.trig',
 *   outDir:      './graphs',
 * });
 * process.exitCode = result.exitCode;
 * ```
 *
 * @category Orchestrator
 * @since 0.1.0
 * @see {@link RunResultInterface}
 * @see {@link RunOptionsInterface}
 * @group Core
 */
export class SquashageOrchestrator {
  private constructor() { /* static-only */ }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Executes a full Squashage build for one target.
   *
   * @remarks
   * The method resolves the target config, applies CLI overrides, constructs
   * the run-wide {@link PipelineContextInterface}, walks the input source,
   * dispatches per-record tasks, drains into the finalize task, and returns
   * the {@link RunResultInterface}.
   *
   * The `rdfjs:finalize` task is invoked exactly once after the final batch
   * settles.  Any error thrown by the finalize task propagates to the caller
   * (the CLI wraps it and sets `process.exitCode = 2`).
   *
   * @param config  - Validated squashage config loaded via {@link SquashageConfig.loadFromFile}.
   * @param target  - Target key to run (must exist in `config.targets`).
   * @param options - Optional CLI override flags.
   * @returns Aggregate run result including counts, quarantine summary, and exit code.
   * @throws {SquashageConfigError} When `target` is not found in `config.targets`.
   * @throws {ExternalSchemaError}  When a task named in `pipeline` is not registered.
   * @throws Any error propagated from `rdfjs:finalize` (I/O, SHACL, serialization).
   */
  public static async run(
    config:  SquashageConfigInterface,
    target:  string,
    options: RunOptionsInterface = {},
  ): Promise<RunResultInterface> {
    logger.info('run', 'Starting Squashage run', { target, options: options as Record<string, unknown> });

    // Step 1 — Look up target config.
    const targetConfig = SquashageOrchestrator.#resolveTarget(config, target);

    // Step 2 — Apply CLI overrides to a synthesized output config.
    const outDir       = options.outDir ?? './graphs';
    const outputConfig = SquashageOrchestrator.#buildOutputConfig(targetConfig, options);

    // Step 3 — Construct run-wide PipelineContextInterface.
    const ctx = SquashageOrchestrator.#buildContext(target, outDir, targetConfig, outputConfig);

    // Step 4 — Strip rdfjs:finalize from per-record tasks; retain a reference.
    const FINALIZE_NAME  = 'rdfjs:finalize';
    const perRecordNames = targetConfig.pipeline.filter(name => name !== FINALIZE_NAME);

    // Build a fresh per-run registry seeded from the global default, so that future
    // per-target classifiers can register onto this instance without cross-contaminating
    // concurrent runs targeting different config entries.
    const registry = new TaskRegistry();
    for (const name of [...perRecordNames, FINALIZE_NAME]) {
      registry.register(name, TaskRegistry.get(name));
    }

    // Retrieve the finalize task from the per-run registry (eagerly validates).
    const finalizeTask = registry.get(FINALIZE_NAME);

    logger.debug('run', 'Pipeline tasks resolved', {
      target,
      perRecord: perRecordNames,
      finalize:  FINALIZE_NAME,
    });

    // Step 5 — Build per-record Pipeline with the per-run registry.
    const pipeline = new Pipeline<PipelineStateInterface>({ name: `squashage:${target}` }, registry);
    for (const name of perRecordNames) pipeline.addTaskByName(name);

    // Step 6 — Walk input source.
    const inputRoot = options.inputOverride ?? targetConfig.input;
    const locators  = await SquashageOrchestrator.#walkInput(inputRoot);

    logger.info('walk', 'Input walk complete', { target, inputRoot, recordCount: locators.length });

    // Step 7 — Build one state per record with per-record context augmentation.
    const states = locators.map(({ recordPath, recordLine }) => {
      const source = { target, path: recordPath };
      const state  = PipelineState.fromInput(target, source, {});

      // Augment the shared context with the record-specific locator so json:read
      // can find the file.  Each record gets its own context object that spreads
      // the run-wide config and adds recordPath / recordLine.
      const recordConfig: Record<string, unknown> = {
        ...(ctx.config as Record<string, unknown>),
        recordPath,
        recordLine,
      };
      const recordCtx: PipelineContextInterface = { ...ctx, config: recordConfig };
      (state as unknown as { context: PipelineContextInterface }).context = recordCtx;

      return state;
    });

    // Step 8 — Execute per-record pipeline with bounded concurrency.
    const concurrency = targetConfig.concurrency ?? 1;
    const runner = ConcurrentPipeline.create<PipelineStateInterface>(pipeline, concurrency, {
      name: `squashage:${target}`,
    });

    logger.debug('execute', 'Dispatching per-record pipeline', {
      target,
      recordCount: states.length,
      concurrency,
    });

    const { completed, failed } = await runner.executeAll(states);

    logger.info('execute', 'Per-record pipeline settled', {
      target,
      succeeded: completed.length,
      failed:    failed.length,
    });

    // Step 9 — Invoke finalize task once with a synthetic state carrying ctx.
    const finalizeState: PipelineStateInterface = {
      targetId:       target,
      source:         { target, path: '__finalize__' },
      input:          {},
      classification: null,
      output:         null,
      context:        ctx,
    };

    logger.debug('finalize', 'Invoking rdfjs:finalize', { target });

    await finalizeTask(async (): Promise<void> => { /* no-op next */ }, finalizeState);

    logger.info('finalize', 'rdfjs:finalize completed', { target });

    // Step 10 — Compute RunResultInterface.
    // A fresh QuarantineWriter.forRun reads zero counts — the actual quarantine
    // counts land in individual task-owned QuarantineWriter instances per record.
    // The orchestrator-level summary here reflects the finalize phase only.
    // Per-record quarantine counts are emitted by json:read into its own writer;
    // those files are already on disk.  The exit-code logic checks projection/
    // conflicts / output buckets from the dataset; since per-record quarantine
    // writers are not shared with this instance, we derive exitCode by checking
    // whether any records failed (failed.length > 0) as a proxy for exit code 1.
    const qw         = QuarantineWriter.forRun(outDir, target);
    const quarantine = qw.summary();
    const exitCode   = failed.length > 0
      ? (1 as const)
      : QuarantineWriter.exitCodeFor(quarantine, false);

    const result: RunResultInterface = {
      target,
      recordCount: locators.length,
      succeeded:   completed.length,
      failed:      failed.length,
      quarantine,
      outputPath:  outputConfig.path,
      exitCode,
    };

    logger.info('summarize', 'Run complete', {
      target,
      recordCount: result.recordCount,
      succeeded:   result.succeeded,
      failed:      result.failed,
      exitCode:    result.exitCode,
    });

    return result;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolves the `TargetConfigInterface` from the config by key.
   *
   * @param config - Root squashage config.
   * @param target - Target key to look up.
   * @returns The resolved target config.
   * @throws {SquashageConfigError} When the key is absent from `config.targets`.
   */
  static #resolveTarget(
    config: SquashageConfigInterface,
    target: string,
  ): TargetConfigInterface {
    const targetConfig = config.targets[target];
    if (targetConfig === undefined) {
      throw SquashageConfigError.create(
        `Target "${target}" not found in squashage config. Available targets: ${Object.keys(config.targets).join(', ')}`,
        { metadata: { target, available: Object.keys(config.targets) } },
      );
    }
    return targetConfig;
  }

  /**
   * Synthesizes a final {@link OutputConfigInterface} from the target config,
   * applying any CLI overrides from `options`.
   *
   * @param targetConfig - Per-target config from the squashage config file.
   * @param options      - CLI override options from the caller.
   * @returns A new, frozen output config object with CLI overrides applied.
   */
  static #buildOutputConfig(
    targetConfig: TargetConfigInterface,
    options:      RunOptionsInterface,
  ): OutputConfigInterface {
    // Build mutable copy then apply overrides imperatively; exactOptionalPropertyTypes
    // forbids spreading conditional `{ dryRun: true }` over an `OutputConfigInterface`
    // whose `dryRun?` is typed as `boolean | undefined`.
    const out: Record<string, unknown> = { ...targetConfig.output as unknown as Record<string, unknown> };

    if (options.outOverride    !== undefined) out['path']   = options.outOverride;
    if (options.formatOverride !== undefined) out['format'] = options.formatOverride;
    if (options.dryRun === true)              out['dryRun'] = true;

    return Object.freeze(out as unknown as OutputConfigInterface);
  }

  /**
   * Constructs the run-wide {@link PipelineContextInterface} from the target
   * config and the resolved output config.
   *
   * @param target       - Target identifier.
   * @param outDir       - Output base directory.
   * @param targetConfig - Validated target config.
   * @param outputConfig - Synthesized output config (CLI overrides already applied).
   * @returns Fully populated `PipelineContextInterface`.
   */
  static #buildContext(
    target:       string,
    outDir:       string,
    targetConfig: TargetConfigInterface,
    outputConfig: OutputConfigInterface,
  ): PipelineContextInterface {
    const ontology = targetConfig.ontology;
    const baseIri  =
      (typeof ontology?.['baseIri'] === 'string' ? ontology['baseIri'] : undefined) ??
      'https://example.org/';

    const graphs = Object.fromEntries(
      Object.entries(targetConfig.graphs ?? {}).map(([k, v]) => [k, dataFactory.namedNode(v)]),
    );

    const ctx: PipelineContextInterface = {
      target,
      outDir,
      config:  Object.freeze({ ...(targetConfig as unknown as Record<string, unknown>) }),
      factory: dataFactory,
      dataset: Dataset.empty(),
      builder: new GraphBuilder(baseIri),
      graphs:  Object.freeze(graphs),
      iri:     Namespaces.for(baseIri),
      output:  outputConfig,
    };

    return ctx;
  }

  /**
   * Walks an input path and returns one {@link RecordLocatorInterface} per record.
   *
   * @remarks
   * Resolution rules:
   * - A path ending `.json`: one record, `recordLine = 0`.
   * - A path ending `.jsonl`: count non-blank lines; one locator per line.
   * - A directory: recursively walked; every `.json` and `.jsonl` file yields
   *   one or more locators.
   * - Anything else (or an inaccessible path): returns an empty array after logging.
   *
   * @param inputPath - Absolute or CWD-relative path to the input file or directory.
   * @returns Array of record locators, one per discoverable input record.
   */
  static async #walkInput(inputPath: string): Promise<RecordLocatorInterface[]> {
    logger.debug('walk', 'Walking input path', { inputPath });

    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(inputPath);
    } catch (err) {
      const cause = err instanceof Error ? err : undefined;
      logger.warn('walk', 'Input path not accessible; returning empty record list', {
        inputPath,
        error: cause?.message,
      });
      return [];
    }

    if (info.isDirectory()) {
      return SquashageOrchestrator.#walkDirectory(inputPath);
    }

    const ext = extname(inputPath).toLowerCase();
    if (ext === '.jsonl') {
      return SquashageOrchestrator.#locatorsFromJsonl(inputPath);
    }

    // Plain .json or unrecognised extension: single record.
    return [{ recordPath: inputPath, recordLine: 0 }];
  }

  /**
   * Recursively walks a directory and collects locators for every `.json`
   * and `.jsonl` file found.
   *
   * @param dirPath - Absolute path to the directory to walk.
   * @returns Flat array of all record locators found under the directory.
   */
  static async #walkDirectory(dirPath: string): Promise<RecordLocatorInterface[]> {
    const results: RecordLocatorInterface[] = [];
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const nested = await SquashageOrchestrator.#walkDirectory(fullPath);
        results.push(...nested);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (ext === '.json') {
          results.push({ recordPath: fullPath, recordLine: 0 });
        } else if (ext === '.jsonl') {
          const locators = await SquashageOrchestrator.#locatorsFromJsonl(fullPath);
          results.push(...locators);
        }
      }
    }

    return results;
  }

  /**
   * Reads a JSONL file and produces one {@link RecordLocatorInterface} per
   * non-blank line.
   *
   * @remarks
   * The file is read once to count lines. Record content is read by `json:read`
   * at pipeline execution time; this method only counts lines and produces locators.
   *
   * @param filePath - Absolute path to the JSONL file.
   * @returns Array of locators, one per non-blank line.
   */
  static async #locatorsFromJsonl(filePath: string): Promise<RecordLocatorInterface[]> {
    const text  = await readFile(filePath, 'utf8');
    const lines = text.split('\n');

    const locators: RecordLocatorInterface[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line !== undefined && line.trim().length > 0) {
        locators.push({ recordPath: filePath, recordLine: i });
      }
    }
    return locators;
  }
}
