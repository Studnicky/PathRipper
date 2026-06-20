import { NodeStateBase } from '@studnicky/dagonizer';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';

import type { PipelinePageInterface } from '../types/PipelineState.js';

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
  page: PipelinePageInterface = { targetId: '', title: '', url: '' };

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
   * Clone state for isolated execution (sub-flows and fan-out).
   *
   * Overrides `NodeStateBase.clone()` (which returns a bare `NodeStateBase`)
   * so domain fields are preserved across sub-DAG dispatch — `executeDeepDAG`
   * runs the child phase against this clone, and `mapOutputState` copies the
   * mutated buckets back to the parent.
   */
  public override clone(): this {
    const cloned = new ScrapeState();
    // Preserve metadata (the base class does this; mirror the contract).
    for (const [key, value] of Object.entries(this.metadata)) {
      cloned.setMetadata(key, value);
    }
    // Deep-copy domain fields so child mutations don't leak back via shared refs.
    cloned.page             = { ...this.page };
    cloned.output           = this.output === null ? null : { ...this.output };
    cloned.urls             = [...this.urls];
    cloned.titles           = [...this.titles];
    cloned.succeeded        = [...this.succeeded];
    cloned.failed           = [...this.failed];
    cloned.recovered        = [...this.recovered];
    cloned.failedAfterRetry = [...this.failedAfterRetry];
    return cloned as this;
  }

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
   * Snapshots domain-specific fields for `Checkpoint.from()`.
   * Called by the engine automatically; do not call directly.
   *
   * Transient plugin metadata keys (prefixed `aonprd`) are deliberately
   * excluded — they carry non-serialisable objects (CheerioAPI handles,
   * CheerioNode objects) and are cheaply re-derived from `state.page.html`
   * if a checkpoint resumes.
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
      this.page = page as unknown as PipelinePageInterface;
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
