---
layout: doc
title: Resilience & crawl-health
---

# Resilience & crawl-health

Ripperoni treats failures as first-class data rather than exceptions that disappear across the worker boundary. Every failed page becomes a written, inspectable document. After the scatter completes, a post-crawl phase classifies each failure and writes a `crawl-health.json` report that answers "is everything captured?" without manual inspection.

## Failures are data, not exceptions

When `html:fetch` cannot retrieve a page it stashes a `FailureContextType` in state metadata under `LAST_FAILURE_KEY` and returns the `error` output port. The DAG routes that port to `route:failure`, which reads the context, increments the attempt counter via `state.recordAttempt('html:fetch')`, and delegates to a `FailurePolicyInterface` implementation to classify the failure:

```ts
export interface FailurePolicyInterface {
  classify(context: FailureContextType): FailureRouteType;
}
```

`FailureContextType` carries the information the policy needs:

```ts
export type FailureContextType = {
  readonly url:      string;
  readonly status:   number | undefined;   // HTTP status, if any
  readonly retryable: boolean;             // transient (5xx / network) vs permanent (4xx)
  readonly attempt:  number;               // 1-based; incremented by route:failure
  readonly phase:    'fetch' | 'parse';
  readonly linkText: string | undefined;   // link text from crawl context, if available
};
```

The policy returns a `FailureRouteType`, whose `route` discriminant drives which output port `route:failure` emits:

```ts
export type FailureRouteType =
  | { readonly route: 'retry' }
  | { readonly route: 'resolve'; readonly strategies: readonly string[] }
  | { readonly route: 'capture' }
  | { readonly route: 'expected'; readonly reason: string };
```

| Route | Meaning |
|-------|---------|
| `retry` | Transient failure within budget; back-edge returns to `html:fetch`. |
| `resolve` | Permanent but potentially wrong-locator; routes to `resolve:link` (opt-in). |
| `capture` | Permanent failure; URL appended to `state.failed`, routed to `error:capture`. |
| `expected` | Known content gap; counted as expected, not errored; routes to the terminal. |

`DefaultFailurePolicy` applies when `services.failurePolicy` is absent. It retries when the failure is retryable and the attempt is within budget (default 2), then captures:

```
retryable && attempt <= maxRetries  →  retry
otherwise                           →  capture
```

This is layered above `HttpRetryPolicy`, which handles per-request transport retries. `FailurePolicy` sees a failure only after the HTTP stack has exhausted its own retry budget and thrown.

### Per-page DAG routing

The `aonprd:page` DAG wires this flow:

```
html:fetch
  success / cached  →  aonprd:parse
  error             →  route:failure
                          retry     →  html:fetch      (back-edge)
                          resolve   →  resolve:link
                          capture   →  error:capture
                          expected  →  completed
```

The error handling is present in every plugin that uses `html:fetch` — the node already emits the context; wiring `error` to `route:failure` is the only author step required.

## error:capture — failures as written documents

When `route:failure` routes `capture`, the `error:capture` node projects `state.errors` into `state.output` as a structured error document:

```json
{
  "_type": "error",
  "url":   "https://2e.aonprd.com/Classes.aspx?ID=77",
  "errors": [
    {
      "code":      "httpError.permanent",
      "message":   "HTTP 404",
      "operation": "html:fetch"
    }
  ]
}
```

The downstream `json:write` node writes this document to disk exactly as it would write a successfully parsed concept. The failure is a file on disk, readable, diffable across runs, and picked up by the post-crawl reconciler. Nothing vanishes across the worker boundary.

`error:capture` emits the `captured` port; `captured` routes to `json:write` in the same step as a success.

## crawl-health.json — the audit surface

After the scatter completes, the orchestration runs two coordinator-side nodes in sequence:

```
scrape (ScatterNode)
  all-success / partial / all-error / empty  →  reconcile:identity
                                                     done  →  report:crawl-health
                                                                 done  →  completed
```

### reconcile:identity

`reconcile:identity` reads every `*.json` file from `<outDir>/<target.id>/`. It partitions them into concepts (`_type` absent or not `'error'`) and failures (`_type === 'error'`). It then calls a `ReconcilerInterface` to build an identity index from the concepts and classify each failure:

```ts
export interface ReconcilerInterface<TIndex = unknown> {
  /**
   * Build an opaque identity index from all successfully captured concepts.
   * The framework threads this value through to every resolveFailure call.
   */
  prepare(concepts: readonly CapturedConceptType[]): TIndex;

  /**
   * Classify a single captured failure against the index.
   */
  resolveFailure(failure: CapturedFailureType, index: TIndex): ResolutionType;
}
```

Each failure resolves to one of three statuses:

```ts
export type ResolutionType =
  | { readonly status: 'capturedElsewhere'; readonly at: string }
  | { readonly status: 'missing' }
  | { readonly status: 'dead'; readonly reason: string };
```

| Status | Meaning |
|--------|---------|
| `capturedElsewhere` | The concept exists in the output at a different URL; the broken link is harmless. |
| `missing` | No matching concept was found; data may be absent. |
| `dead` | The resource is known to not exist (lore-only, etc.); the failure is expected. |

The node writes the resolution back into the error doc on disk so each failure file carries its own verdict, then stashes a `ReconciliationSummaryType` in state metadata for the downstream reporter.

`DefaultReconciler` classifies every failure as `missing` — valid and complete, just conservative. Targets without a plugin reconciler still produce a full report.

### report:crawl-health

`report:crawl-health` reads the summary from metadata and writes `<outDir>/<target.id>/crawl-health.json`:

```json
{
  "generatedAt": "2026-06-21T09:00:00.000Z",
  "target": "aonprd",
  "totals": {
    "concepts":          3541,
    "failures":             4,
    "capturedElsewhere":    1,
    "missing":              2,
    "dead":                 1
  },
  "capturedElsewhere": [
    {
      "url": "https://2e.aonprd.com/Classes.aspx?ID=77",
      "at":  "https://2e.aonprd.com/Ancestries.aspx?ID=77"
    }
  ],
  "missing": [
    {
      "url": "https://2e.aonprd.com/Equipment.aspx?ID=3611",
      "errors": [{ "code": "httpError.permanent", "message": "HTTP 404" }]
    },
    {
      "url": "https://2e.aonprd.com/Monsters.aspx?ID=3542",
      "errors": [{ "code": "httpError.permanent", "message": "HTTP 404" }]
    }
  ],
  "dead": [
    {
      "url":    "https://2e.aonprd.com/Ancestries.aspx?ID=9",
      "reason": "content removed from AON"
    }
  ]
}
```

### Worked example: AonprdReconciler

The `AonprdReconciler` shows what a real reconciler looks like. AON's broken cross-category links preserve the numeric `?ID=` from the real concept — the catfolk ancestry at `Ancestries.aspx?ID=77` is mislinked as `Classes.aspx?ID=77`. The reconciler catches this.

`prepare` builds two maps from all captured concept docs:
- `nameIdToUrl` — `"catfolk|77"` → `"https://2e.aonprd.com/Ancestries.aspx?ID=77"`
- `hrefToTexts` — `"Classes.aspx?ID=77"` → `["Catfolk"]` (the link text pointing at the broken URL)

`resolveFailure` looks up the broken URL's relative href in `hrefToTexts` to get the link text, then looks up `text|id` in `nameIdToUrl`. Both keys must match — name AND numeric id — so "Catfolk" + 77 resolves to the ancestry, not to any other concept that might share the name at a different id.

Result: `{ status: 'capturedElsewhere', at: 'https://2e.aonprd.com/Ancestries.aspx?ID=77' }`.

The broken link in AON's own content is harmless: the concept is captured, just under the correct URL rather than the mislinked one.

## resolve:link — opt-in wrong-locator recovery

When `route:failure` classifies a failure as `resolve` (possible wrong-locator URL), the `resolve:link` node attempts to recover a corrected URL before falling back to `error:capture`. It is strictly opt-in: with no `services.resolve` configured, it routes immediately to `unresolved`.

Configure it via `services.resolve`:

```ts
export type ResolveConfigType = {
  /** Ordered strategy names to attempt. */
  readonly strategies:   readonly string[];
  /** Category names for the crossLocator strategy. */
  readonly categorySet?: readonly string[] | undefined;
  /** URL template for the search strategy; {q} is replaced with URL-encoded link text. */
  readonly searchUrl?:   string | undefined;
  /** Max resolve attempts per page (default 2). */
  readonly budget?:      number | undefined;
};
```

Three built-in strategies are registered in `LinkResolverRegistry`:

| Strategy | Behaviour |
|----------|-----------|
| `crossLocator` | Parses `<Category>.aspx?ID=<n>` from the failed URL; tries every category in `categorySet` with the same `ID`. Returns the first that fetches without error. |
| `canonical` | Fetches the failed URL and looks for `<link rel="canonical" href="...">`. Returns the canonical href when present and different. |
| `search` | Placeholder. Returns `null` until the strategy contract is extended to carry link text from the failure context. |

When a strategy succeeds, `resolve:link` stashes the corrected URL under `state.setMetadata('currentUrl', corrected)` and emits `resolved`, routing back to `html:fetch` for a re-fetch. If no strategy succeeds it emits `unresolved`, routing to `error:capture`.

AON does not configure `services.resolve`, so for AON `resolve:link` is dormant (always `unresolved`). The `AonprdReconciler` handles the same class of problem post-crawl without live re-fetching.

## Wiring it in a plugin

Three fields on `RipperServices` control the resilience layer:

```ts
/** Failure policy; DefaultFailurePolicy when absent. */
readonly failurePolicy?: FailurePolicyInterface | undefined;

/** Identity reconciler; DefaultReconciler when absent. */
readonly reconciler?: ReconcilerInterface | undefined;

/** Link-resolution config; resolve:link is dormant when absent. */
readonly resolve?: ResolveConfigType | undefined;
```

A plugin sets these by exporting a `reconciler` singleton that `PluginLoader` picks up and passes through to `services.reconciler` at run time:

```ts
// plugins/aonprd/index.ts
import { aonprdReconciler } from './AonprdReconciler.js';

export const reconciler = aonprdReconciler;

export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  // register parse nodes...
}
```

The per-page DAG (`aonprd:page`) already includes `route:failure`, `resolve:link`, and `error:capture` in its wiring. Every plugin that uses `html:fetch` gets the full failure routing for free by wiring the `error` port to `route:failure`. The post-crawl phase (`reconcile:identity` → `report:crawl-health`) is wired once in the orchestration DAG, not in the plugin.

## Related

- [Plugins](/usage/plugins): plugin contract and `register(dispatcher)` export
- [Crawler](/usage/crawler): the `crawl:discover` embedded DAG that feeds the scatter
- [Architecture](/architecture): node source map and orchestration flow
