# Squashage Architecture

Squashage is a graph reconstitution pipeline. It starts where Ripperoni stops:
with structured JSON records already extracted from source material. It ends
with a single serialized RDF file produced by the build run.

```text
Ripperoni
  source -> raw page -> parse task -> JSON record

Squashage
  JSON record -> classify -> normalize -> RDF/JS quads -> serialized file
                                                          (v0.x: turtle | trig | nquads | ntriples | jsonld
                                                           v1.x: adds rdfxml, n3)
```

RDF/JS is the **internal canonical product** of the build — the shape every
plugin emits into and the serializer reads from. It is not the output. The
output is the file. To load the file into a graph store, hand it to
downstream graph-store loaders separately; Squashage does not load stores.

## Package Boundaries

Squashage *uses* a thin `src/rdf/*` and `src/shacl/*` wrapper layer over
permissive open-source RDF libraries (`@rdfjs/data-model`, `@rdfjs/dataset`,
`@rdfjs/namespace`, `n3`, `jsonld`, `rdf-canonize`, `rdf-validate-shacl`)
for every RDF/JS implementation detail. It does not vendor those
implementations directly into application code, and it does not own
graph-store loading. v1.x will swap the wrapper bodies to the unpublished
`@semantics/*` workspace without changing the application surface — the
boundary is the wrapper, not a specific package.

| Package | Owns | Does Not Own |
|---------|------|--------------|
| Ripperoni | acquisition, fetching, crawling, source parsing, JSON output | classification, ontology projection, RDF/JS quads, graph identity |
| Squashage | classification, normalization, projection of records into RDF/JS, pipeline + task registry, single-file output and quarantine reports | RDF/JS implementations (factory, dataset), parser/serializer code, graph-store loading, format → format translation |
| Semantics | RDF/JS factories and datasets, parse/serialize for all supported formats, store adapters (in-memory, embedded, remote), canonicalization, validation, vocabulary, IRI utilities, reasoning, format and store CLIs | source extraction, source-specific classification, ripperoni-shape JSON ingestion |
| Torreya | ontology conventions and runtime graph usage that consumes squashage output | source extraction, generic classification framework |

## Core Concepts

### Input Record

An input record is a single JSON object from Ripperoni. It should include enough
source metadata to make classification reproducible:

```json
{
  "_type": "pokemon",
  "title": "Bulbasaur",
  "name": "Bulbasaur",
  "ndex": 1,
  "types": ["Grass", "Poison"],
  "_source": {
    "target": "bulbapedia",
    "path": "bulbasaur.json",
    "plugin": "bulbapedia:parse"
  }
}
```

### Classification

Classification identifies the ontology class or projection lane for an input
record. It is not just a label; it is a decision with evidence.

```json
{
  "type": "pokemon",
  "confidence": 1,
  "engine": "schema+rules",
  "reasons": [
    "input._type == pokemon",
    "required keys present: ndex, types",
    "target graph: universal/species"
  ]
}
```

### RDF/JS As Internal Canonical Product

Plugins emit RDF/JS terms and quads into a shared dataset. The canonical
factory and dataset come from `src/rdf/DataFactory.ts` and
`src/rdf/Dataset.ts` (v0.x backed by `@rdfjs/data-model` and
`@rdfjs/dataset`); convenience builders come from `src/rdf/GraphBuilder.ts`
(vendored from semantics/rdf-builder). Plugins do not write Turtle,
JSON-LD, or any other format directly — they emit quads, and the finalize
step serializes the canonical dataset to the configured output file via
`src/rdf/Serializer.ts`.

`PipelineStateInterface` and `PipelineContextInterface` keep their existing
names from `src/types/PipelineState.ts`; their fields adapt to the
graph-reconstitution domain. The full type definitions live in
`src/types/PipelineState.ts` and are documented inline; plan 13 carries
the rationale and the `ClassificationProposalInterface` /
`ClassificationEvidenceInterface` shapes the cascade populates.

### File Output

The output is a single serialized RDF file in one of the formats
squashage's `src/rdf/Serializer.ts` supports. **v0.x**: Turtle, TriG,
N-Triples, N-Quads, JSON-LD. **v1.x**: adds RDF/XML and N3 once the
semantics workspace consumes. Format defaults from the file extension via
`src/rdf/Formats.ts`.

A target must declare an `output` block. To produce more than one file,
re-run the build with a different `--out`. To translate between formats
or load into a graph store, use any RDF format converter or graph-store
loader of your choice on the produced file — neither is squashage's
job. See
[`plans/13-file-output-and-semantics-integration.md`](plans/13-file-output-and-semantics-integration.md)
for the output interface, configuration, failure policy, and dependency
layout.

Programmatic callers can additionally consume the in-process dataset directly
through the build API; that is not an output, just the API return value.

## Pipeline Phases

1. `json:read`: load one JSON object and attach source metadata.
2. `classify:*`: determine candidate and final class with evidence.
3. `normalize:*`: canonicalize labels, slugs, numbers, dates, and IDs.
4. `squash:*`: project the record into RDF/JS quads using
   `src/rdf/GraphBuilder.ts` against the canonical dataset.
5. `rdfjs:finalize`: serialize the canonical dataset to the configured
   output file via `src/rdf/Serializer.ts`, run any configured
   canonicalization (`src/rdf/Canonicalize.ts`) and SHACL validation
   (`src/shacl/ShaclGate.ts`), and write the output report.

## Failure Policy

Failures land as explicit artifacts on disk:

- Unknown class: `./graphs/<target>/quarantine/unknown/<id>.json`.
- Classification conflict: `./graphs/<target>/quarantine/conflicts/<id>.json`
  with the tied candidates preserved.
- Projection failure (parse error in `json:read`, throw in a `squash:*`
  task): `./graphs/<target>/quarantine/projection/<id>.json`.
- Pre-write SHACL failure: `./graphs/<target>/quarantine/output/validation.report.{txt,ttl}`.
  The destination output file is not written.
- Atomic-write failure: a `<output.path>.partial` artifact alongside the
  intended destination, plus the run's `output.report.json`.

Quarantine is a *graceful* path. `json:read` and the classifier tasks
short-circuit with a quarantine write rather than throwing, so the
per-record pipeline registers no failure and the build exit code stays
`0`. Quarantine artifacts on disk are how the caller learns which
records were rejected. Exit codes:

- `0` — every record either projected cleanly or landed in quarantine
  gracefully.
- `1` — a per-record task threw, or `rdfjs:finalize` threw (output,
  validation, atomic-write).
- `2` — config / schema / startup error before any record processed.

## Migration History

The repository was bootstrapped as a literal copy of Ripperoni and
migrated module-by-module. The full record — file inventory with
importer-evidence-based deletion plan, ordered migration steps, code
standards inherited verbatim, AJV cross-validation, deterministic
classifier menu — lives in
[`plans/13-file-output-and-semantics-integration.md`](plans/13-file-output-and-semantics-integration.md).

The scraper layer (HtmlScraper, MediaWikiScraper, LinkLister,
ScrapeOrchestrator, the cache, the rate limiter, the retry executor)
was deleted wholesale. `PipelineStateInterface` and
`PipelineContextInterface` kept their names but redefined their fields
for the graph-reconstitution domain. Built-in classification tasks live
in `src/classification/tasks/`; the predicate engine in
`src/classification/predicates/`; configuration in
`src/schemas/*.json`.
