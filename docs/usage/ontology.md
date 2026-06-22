---
layout: doc
title: Ontology (json-tology)
description: Squashage ontology — plugins construct JsonTologyOntology in register() and pass it to OntologyProjectionNode. services.ontology is always null at the framework level.
---

# Ontology

The ontology is plugin-owned. Plugins construct a `JsonTologyOntology` instance inside `register()` and pass it directly to `OntologyProjectionNode`. `services.ontology` is always `null` at the framework level — the framework does not build or inject an ontology.

## json-tology projection

ABox projection runs on `@studnicky/json-tology`. Projection is **lenient**: no record is dropped on shape mismatch. A record whose class maps to a known schema projects against that schema; a record whose class has no schema mapping projects under the **Generic fallback class**, so every classified record reaches the graph. The Generic fallback keeps the open-world contract intact — unmapped data is still typed and queryable rather than quarantined.

## Plugin-built ontology

The plugin calls `JsonTologyOntology.create()` with core schemas and any plugin-specific leaf schemas, then passes the result to `OntologyProjectionNode`:

```ts
const ontology = await JsonTologyOntology.create({
  baseIRI:  'https://squashage.dev/vocabulary/aonprd',
  schemas:  [...coreInputs, ...myLeafSchemas, ...extractedInputs],
});
dispatcher.registerNode(new OntologyProjectionNode(ontology));
```

`JsonTologyOntology.create()`:

1. Reads each schema entry.
2. Derives `className` from the schema `title` field (falls back to the last `$id` segment if `title` is absent).
3. Builds class IRIs as `${baseIRI}#${className}`.
4. Returns a `JsonTologyOntology` instance the plugin passes to `OntologyProjectionNode`.

See [Plugins](./plugins) for the full `register()` contract.

## Schema requirements

Each schema must have:

- `$id` (string): a URI identifying the schema. Used as the lookup key in `ontology.toQuads(schemaId, instance)` inside `OntologyProjectionNode`.
- `title` (string, recommended): becomes the `className`. Without `title`, the last segment of `$id` is used. If the last segment is empty or degenerate, `JsonTologyOntology.create()` throws.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://squashage.dev/schemas/aonprd/feat",
  "title": "Feat",
  "type": "object",
  "properties": {
    "name": { "type": "string" }
  }
}
```

## Pipeline state machine

The ontology and TBox/SHACL files are produced through the following sequence:

```
Plugin register()
  |
  v
loadCoreSchemaInputs() + loadExtractedSchemaInputs(PLUGIN_DIR)
  - reads core and plugin-specific leaf schemas
  |
  v
JsonTologyOntology.create({ baseIRI, schemas })
  - derives className and class IRIs from schema title/$id
  - any derivation error surfaces here
  |
  v
OntologyProjectionNode(ontology) registered on dispatcher
  |
  v
Per-record DAG (json-read, classify:*, squash via OntologyProjectionNode, ...)
  - OntologyProjectionNode calls ontology.toQuads(schemaId, record)
  - records with no schema mapping project under the Generic fallback class
  |
  v
rdfjs-finalize
  - serializes the canonical dataset to the output file
  |
  v
ontology-emit (if configured)
  - calls ontology.tbox()  -> OWL TBox quads
  - calls ontology.shacl() -> SHACL shape quads
  - serializes each to TriG (named-graph-aware)
  |
  v
Done
```

## OntologyProjectionNode

`OntologyProjectionNode` is a class, not a singleton. The plugin instantiates it with the ontology it built and registers it on the dispatcher. The node calls `ontology.toQuads(schemaId, record)` internally to project each classified record into typed RDF quads.

```ts
dispatcher.registerNode(new OntologyProjectionNode(ontology));
```

`services.ontology` is always `null` — the ontology instance lives inside `OntologyProjectionNode`, not on services. Nodes that need to call `toQuads` directly hold a reference to the ontology they were constructed with, not a service lookup.

## Edge cases

**Missing schema title**: If a schema has no `title` and its `$id` ends with an empty segment (e.g. `https://example.org/`), `JsonTologyOntology.create()` throws. Fix: add an explicit `title` to the schema.

**IRI conflicts**: If two schemas derive the same `className` (e.g. two schemas both titled `"Widget"`), `JsonTologyOntology.create()` throws. Fix: ensure all `title` values (or `$id` trailing segments) are unique within the schemas array passed to `create()`.

**Empty schemas array**: Passing `schemas: []` to `JsonTologyOntology.create()` is rejected. The plugin must supply at least the core schema inputs.

**emit paths not configured**: If `ontology-emit` is not wired in the plugin DAG, no TBox or SHACL files are written. This is intentional: the ontology can be active for ABox projection without emitting TBox or SHACL files.

**TriG output format**: TBox and SHACL quads from json-tology include named graph IRIs (e.g. `https://squashage.dev/vocabulary/aonprd/ontology/`). The `ontology-emit` node serializes them as TriG. Despite the `.ttl` extension convention, the files are valid TriG documents.

## Worked example: aonprd plugin

The aonprd plugin calls `JsonTologyOntology.create()` with five leaf schemas and passes the result to `OntologyProjectionNode`. Each schema has a `title` (`"Feat"`, `"Spell"`, etc.).

Class IRIs derive as:

| title | class IRI |
|-------|-----------|
| Feat  | `https://squashage.dev/vocabulary/aonprd#Feat` |
| Spell | `https://squashage.dev/vocabulary/aonprd#Spell` |
| Monster | `https://squashage.dev/vocabulary/aonprd#Monster` |
| Action | `https://squashage.dev/vocabulary/aonprd#Action` |
| Equipment | `https://squashage.dev/vocabulary/aonprd#Equipment` |
