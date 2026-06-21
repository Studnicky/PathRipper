import { NodeStateBase } from '@studnicky/dagonizer';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';

import type { PipelinePageType } from '../types/PipelineState.js';
import type { RunStateType }     from '../types/RunState.js';

/**
 * Shared state flowing through every node in a scrape DAG.
 *
 * @remarks
 * Extends `NodeStateBase` from `@studnicky/dagonizer` so the dispatcher can
 * manage the execution lifecycle, collect errors/warnings, and checkpoint the
 * state for resumable runs.
 *
 * `page` carries the currently-scraped document (URL, HTML, wikitext).
 * `output` is `null` until a parse node populates it; write nodes skip when `null`.
 * `urls` / `titles` are the source arrays for fan-out placements.
 *
 * ### Result-array contract (three-bucket retry shape)
 *
 * The outer DAG runs three phases: discovery → scrape → retry. Result items
 * land in one of three sibling arrays:
 *
 * - `succeeded` — items that completed on the **first** attempt (scrape phase).
 * - `recovered` — items that initially failed but succeeded on retry.
 * - `failedAfterRetry` — items that failed both the initial attempt and the retry;
 *   this is what the orchestrator writes to `failures.json`.
 *
 * `failed` is the transient bucket between the scrape and retry phases — it
 * carries the initial-attempt failures into the retry phase's fan-out source,
 * and is drained by the retry phase (items move to either `recovered` or
 * `failedAfterRetry`).
 *
 * Consumers querying outcomes should treat the three terminal arrays
 * (`succeeded`, `recovered`, `failedAfterRetry`) as the authoritative report;
 * `failed` is meaningful only mid-flow.
 *
 * @category State
 * @since 3.0.0
 */
export class ScrapeState extends NodeStateBase {
  /** Currently-active page document (set per fan-out item by fetch nodes). */
  page: PipelinePageType = { targetId: '', title: '', url: '' };

  /** Plugin-populated output; `null` until a parse node writes to it. */
  output: Record<string, unknown> | null = null;

  /**
   * Source array for HTML fan-out.
   * Each item is a URL string to fetch + process in the per-URL sub-flow.
   */
  urls: string[] = [];

  /**
   * Source array for MediaWiki fan-out.
   * Each item is a page title to fetch + process in the per-title sub-flow.
   */
  titles: string[] = [];

  /**
   * Items that completed successfully on the first attempt (scrape phase).
   * Populated by the scrape-phase fan-in `partition` strategy.
   */
  succeeded: string[] = [];

  /**
   * Transient bucket: items that failed the initial scrape phase.
   * Drained by the retry phase into `recovered` / `failedAfterRetry`.
   */
  failed: string[] = [];

  /**
   * Items that failed the initial attempt but succeeded on retry.
   * Populated by the retry-phase fan-in `partition` strategy.
   */
  recovered: string[] = [];

  /**
   * Items that failed both the initial attempt and the retry.
   * Written to `failures.json` by the orchestrator after the DAG completes.
   */
  failedAfterRetry: string[] = [];

  /**
   * Run params seeded by `runDag` for the native-DAG execution model.
   *
   * Present when the run was started via `runDag`; `undefined` when a
   * `ScrapeState` is constructed directly (e.g. in isolated unit tests).
   * Nodes read run params from here.
   */
  params?: RunStateType | undefined;

  /**
   * Clear transient plugin metadata at end-of-parse so per-page state doesn't
   * leak across parses in fan-out dispatchers, and so large objects (CheerioAPI
   * handles holding multi-MB parsed DOM trees) get released eagerly.
   *
   * Default-clears the keys this codebase's aonprd plugin writes. Callers
   * supplying `keys` override the default list (use for other plugins).
   */
  clearTransientMetadata(keys?: readonly string[]): void {
    const toClear = keys ?? [
      'aonprdCheerio',
      'aonprdCommon',
      'aonprdTarget',
      'aonprdConceptId',
      'aonprdRuleContext',
      'aonprdMetaTags',
      'field_map',
      'fields',
      'sections',
      'source',
      'sources',
    ];
    // NodeStateBase exposes metadata as Readonly<Record<…>>; cast through to
    // delete keys outright (setMetadata(key, undefined) keeps the key with a
    // stale undefined value, which still retains downstream object refs).
    const meta = this.metadata as Record<string, unknown>;
    for (const key of toClear) {
      delete meta[key];
    }
  }

  /**
   * Serialize state to a JSON-safe snapshot for transport or checkpointing.
   *
   * Overrides the base to clear transient non-serialisable plugin metadata
   * (CheerioAPI handles, CheerioNode objects) IN PLACE on `this._metadata`
   * before `super.snapshot()` spreads `_metadata` into the wire object.
   * `clearTransientMetadata` deletes the keys directly from `this.metadata`
   * via a cast — it does not operate on a copy.
   *
   * The cleared handles (CheerioAPI etc.) are cheaply re-derived from
   * `state.page.html` by `aonprd:load-and-common` when a worker thread or
   * checkpoint resumes execution for the next node in the pipeline.
   *
   * At the coordinator's worker-handoff point none of the transient metadata
   * keys are set yet — `html:fetch` runs first (populating `state.page.html`),
   * and the parse nodes that write these keys run inside the worker. The
   * `clearTransientMetadata` call at coordinator snapshot time is therefore
   * a no-op for the coordinator and never strips handles the coordinator
   * still needs.
   */
  override snapshot(): JsonObjectType {
    this.clearTransientMetadata();
    return super.snapshot();
  }

  /**
   * Snapshots domain-specific fields for `Checkpoint.from()`.
   * Called by the engine automatically; do not call directly.
   */
  protected override snapshotData(): JsonObjectType {
    return {
      page:             this.page as unknown as JsonObjectType,
      output:           this.output as JsonObjectType | null,
      urls:             [...this.urls],
      titles:           [...this.titles],
      succeeded:        [...this.succeeded],
      failed:           [...this.failed],
      recovered:        [...this.recovered],
      failedAfterRetry: [...this.failedAfterRetry],
    };
  }

  /**
   * Restores domain-specific fields from a checkpoint snapshot.
   * Called by `Checkpoint.restore()`; do not call directly.
   */
  protected override restoreData(snap: JsonObjectType): void {
    const page = snap['page'];
    if (page !== null && typeof page === 'object' && !Array.isArray(page)) {
      this.page = page as unknown as PipelinePageType;
    }
    const out = snap['output'];
    this.output = (out !== null && typeof out === 'object' && !Array.isArray(out))
      ? (out as Record<string, unknown>)
      : null;
    const urls = snap['urls'];
    if (Array.isArray(urls)) this.urls = urls as string[];
    const titles = snap['titles'];
    if (Array.isArray(titles)) this.titles = titles as string[];
    const succ = snap['succeeded'];
    if (Array.isArray(succ)) this.succeeded = succ as string[];
    const fail = snap['failed'];
    if (Array.isArray(fail)) this.failed = fail as string[];
    const rec = snap['recovered'];
    if (Array.isArray(rec)) this.recovered = rec as string[];
    const failedAfterRetrySnap = snap['failedAfterRetry'];
    if (Array.isArray(failedAfterRetrySnap)) this.failedAfterRetry = failedAfterRetrySnap as string[];
  }
}
