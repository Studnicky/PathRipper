import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

import { ScrapeState }     from '../state/ScrapeState.js';
import type { RipperServices } from '../services/RipperServices.js';

// ── Per-page state ─────────────────────────────────────────────────────────────

/**
 * Isolated state for a single-page child DAG dispatch.
 *
 * Extends `ScrapeState` so the child DAG nodes (`html:fetch`, `json:write`, etc.)
 * can read and write `state.page`, `state.output`, and `state.failed` exactly as
 * they do in the outer DAG — no per-node changes required.
 */
class PageScrapeState extends ScrapeState {
  /** The item identifier (URL or title) being processed. Informational. */
  readonly itemId: string;

  public constructor(itemId: string) {
    super();
    this.itemId = itemId;
  }
}

// ── Dispatch wrapper node ──────────────────────────────────────────────────────

/**
 * Dispatch wrapper node — the single node every per-item phase fan-out invokes.
 *
 * On each execution:
 * 1. Reads the current item identifier from `state.metadata` — the wrapper
 *    walks the configured `itemMetadataKeys` list and uses the first key that
 *    is set. This is what lets the same wrapper serve both the initial scrape
 *    phase (`currentUrl` / `currentTitle`) and the retry phase
 *    (`currentRetryUrl` / `currentRetryTitle`).
 * 2. Initialises a fresh `PageScrapeState` and runs `pageSetup` on it.
 * 3. Dispatches the per-page child DAG via `context.services.dispatcher.execute()`.
 * 4. Returns `{ output: 'success' }` when the child completes without page
 *    failures, `{ output: 'error' }` otherwise.
 *
 * State tracking (`state.succeeded` / `state.failed` / `state.recovered` /
 * `state.failedAfterRetry`) is handled entirely by the outer fan-out's
 * `partition` fan-in strategy — this node does NOT write to those arrays. The
 * outer fan-in reads the output port returned here and routes the item key to
 * the correct partition.
 *
 * @category Nodes
 * @since 3.0.0
 */
export const makeDispatchPageDagNode = (opts: {
  /** Registered name for this dispatch node (e.g. `'html:dispatch-page-dag'`). */
  nodeName:       string;
  /** Deterministic name of the per-page child DAG to execute. */
  childDagName:   string;
  /**
   * Ordered list of metadata keys to inspect for the current item value.
   * The first key with a defined value wins. Lets the wrapper serve multiple
   * fan-out phases (e.g. `['currentUrl', 'currentRetryUrl']`).
   */
  itemMetadataKeys: ReadonlyArray<string>;
  /** The scrape target id, used to initialise `state.page.targetId`. */
  targetId:       string;
  /**
   * Populates `page` on the child `ScrapeState` before dispatching.
   * Receives the raw item value (URL string or title string).
   */
  pageSetup: (state: ScrapeState, itemValue: string) => void;
}): NodeInterface<ScrapeState, 'success' | 'error', RipperServices> => ({
  name:    opts.nodeName,
  outputs: ['success', 'error'],

  async execute(
    state:   ScrapeState,
    context: NodeContextInterface<RipperServices>,
  ): Promise<{ output: 'success' | 'error' }> {
    const { services } = context;

    // Walk the configured key list; first defined value wins.
    let itemValue = '';
    for (const key of opts.itemMetadataKeys) {
      const value = state.getMetadata<string>(key);
      if (value !== undefined && value.length > 0) {
        itemValue = value;
        break;
      }
    }

    // Build isolated per-page state — a fresh ScrapeState subclass so all
    // child nodes have access to page, output, urls, failed, etc.
    const pageState = new PageScrapeState(itemValue);
    opts.pageSetup(pageState, itemValue);

    try {
      await services.dispatcher.execute(
        opts.childDagName,
        pageState,
        { signal: context.signal },
      );
    } catch (err) {
      // Dispatcher-level error (unknown DAG, unwired output, etc.) — log and fail.
      services.log.error('DispatchPageDagNode', `Child DAG threw for item "${itemValue}": ${String(err)}`);
      return { output: 'error' };
    }

    // Determine outcome from the child page state.
    // The child DAG is considered failed if:
    //   • any page-level errors were collected in pageState
    //   • the lifecycle terminated as failed (a node threw internally)
    const hasFailed =
      pageState.failed.length > 0 ||
      pageState.lifecycle.kind === 'failed';

    return { output: hasFailed ? 'error' : 'success' };
  },
});

/**
 * OperationContract for dispatch-page-dag nodes (html:dispatch-page-dag / wiki:dispatch-page-dag).
 * These read from state.urls / state.titles via fan-out metadata; produces no direct state field.
 */
export const makeDispatchPageDagContract = (name: string): OperationContract => ({
  name,
  hardRequired: [],
  produces:     [],
  outputs:      ['success', 'error'],
});
