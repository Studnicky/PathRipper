---
layout: doc
title: Entity-link enrichment
description: The href-reconcile enrichment engine resolves link-item reference nodes to canonical entities inline during the scatter, collapsing ~136k mention-nodes into direct parent→entity edges and eliminating duplicate quads.
---

# Entity-link enrichment

## Problem framing

The json-tology projection layer creates a fresh skolem node for every item in an array
property (`links`, `family_links`, …). A feat that links to the Leshy ancestry creates a
node `instances/…/links/items-<hash>` carrying `href`, `text`, `id`, and `kind` — but
never an edge to the canonical Leshy entity itself. Each parent that links to Leshy mints
its own copy, so the same entity floods the graph as thousands of disconnected mention-nodes
with no readable label.

The `href-reconcile` engine closes this gap. It resolves every link-item node to its
canonical entity target and rewrites the parent edge to point there directly, collapsing
mention-nodes out of the graph and leaving only named entity-to-entity connections.

## When it runs

Resolution runs **inline during the scatter** — not as a post-processing pass. A lightweight
pre-scan node (`index-entities`) runs before `process-all-records` and builds a complete
canonical index from the input files. Each record's `ontologyProjection` node resolves its
own link items against that index at write time. No second full pass over the data is needed.

`enrich-entity-link` runs after the scatter settles and logs the summary counts.

## DAG topology

```
walk-input
    ──walked──► index-entities   (pre-scan: builds canonical entity index)
                    ──indexed/skipped──► process-all-records
                                              (each record: classify → project → resolve inline)
                        ──all-success/partial──► enrich-entity-link   (confirm + log)
                                                      ──enriched/skipped──► ontology-emit
```

See [DAG](./pipeline) for the full run-scope topology.

## How resolution works

**Phase 1 — pre-scan (`index-entities` node).**  
Scans all input files using only the `SubjectIriPolicy` (no RDF projection). For each
record it reads the configured URL pointer (e.g. `/url`), applies the same sanitize
strategy the main projection uses, and stores `hrefTail → canonicalIri` in `services.entityIndex`.
Only records whose canonical IRI falls under `canonicalBase` are indexed; hash-fallback
IRIs are excluded. The complete index is typically ~20k entries and takes 2–3 seconds.

**Phase 2 — inline resolution (per-record, inside `ontologyProjection`).**  
After json-tology produces the raw quad set for a record, the resolver scans for quads
where the predicate is one of the configured `linkPredicates`. For each such edge whose
object is a link-item node, the resolver reads the item's `hrefPredicate` value, looks it
up in the canonical index, and either:

- **Resolved** → rewrites `<parent> <linkPred> <itemNode>` to `<parent> <linkPred> <canonicalIri>` and drops all quads whose subject is the item node. The skolem node is never written.
- **Unresolved** (off-dataset link) → keeps the item node and its `text` property so the viewer can label it.

**Phase 3 — in-pass dedup.**  
When `dedupeTriples: "inPass"` is configured, a `Set<string>` in `services.dedupSet` tracks
quad signatures across all records. Quads already written are silently skipped, eliminating
the exact duplicate triples that arise when multiple parents link to the same off-dataset
target.

## Configuration

Add an `enrichment` block at the config root, sibling to `classification` and `output`:

```json
{
  "enrichment": {
    "entityLink": {
      "engine":         "href-reconcile",
      "linkPredicates": [
        "https://2e.aonprd.com/links",
        "https://2e.aonprd.com/family_links"
      ],
      "hrefPredicate":  "https://2e.aonprd.com/href",
      "canonicalBase":  "https://squashage.dev/instance/aonprd/",
      "dedupeTriples":  "inPass"
    }
  }
}
```

### Field reference

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `engine` | `"href-reconcile"` | yes | — | Resolution engine. |
| `linkPredicates` | `string[]` | yes | — | Predicate IRIs that connect a canonical entity to a link-item node. |
| `hrefPredicate` | `string` | yes | — | Predicate IRI on link-item nodes carrying the resolvable relative href. |
| `canonicalBase` | `string` | yes | — | IRI prefix shared by all canonical entities (must end with `/`). |
| `dedupeTriples` | `"inPass" \| "sortUnique" \| false` | no | `"inPass"` | Triple deduplication mode. `"inPass"` uses an in-memory hash set; `"sortUnique"` runs an external sort-unique pass; `false` disables dedup. |

## Worked example (AONPRD)

### Before enrichment

The Leshy ancestry entity links to the Concealed condition:

```turtle
# canonical entity
<squashage.dev/instance/aonprd/Ancestries.aspx?ID=14>
    aonprd:links  <2e.aonprd.com/instances/…/links/items-abc123> .

# link-item skolem node
<2e.aonprd.com/instances/…/links/items-abc123>
    aonprd:href  "Conditions.aspx?ID=4" ;
    aonprd:text  "Concealed" .
```

### After enrichment

```turtle
# direct canonical edge — skolem node gone
<squashage.dev/instance/aonprd/Ancestries.aspx?ID=14>
    aonprd:links  <squashage.dev/instance/aonprd/Conditions.aspx?ID=4> .
```

## Results on the AONPRD dataset

| Metric | Before | After |
|---|---|---|
| Link edges → canonical entity | 0 | **370,649** |
| Link edges → unresolved skolem | — | 142,231 (off-dataset) |
| Duplicate quad lines | 427,606 | **0** |
| Total quads | 4,614,923 | 1,741,985 |

## Edge cases

### Off-dataset hrefs

Links to page types not present in the input dataset (e.g. `Articles.aspx`, `NPCs.aspx`)
remain as unresolved link-item nodes. They keep their `text` property so the visualiser
can display a label. This is correct — open-world; the edge simply doesn't resolve.

### Same entity, different editions

AONPRD publishes both legacy and remaster editions of some entities under distinct IDs
(e.g. `Ancestries.aspx?ID=14` vs `Ancestries.aspx?ID=65` for Leshy). Both are indexed as
separate canonical entities and resolve correctly because the key is the full href tail
including the ID, not just the name.

### Dedup accuracy at concurrency > 1

The `"inPass"` dedup set is shared across concurrent record projections. At `concurrency > 1`,
two projections may race on the set and both emit the same quad. For exact dedup, run at
`concurrency: 1` or use `"sortUnique"`.
