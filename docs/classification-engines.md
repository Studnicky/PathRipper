# Classification Engines

Squashage classification must be deterministic by default. The build should be
safe to re-run on the same inputs and produce the same RDF/JS quads, failure
manifests, and evidence reports.

## Classifier Cascade

Use a cascade rather than one monolithic classifier:

1. **Source contract**: trust the configured target and source plugin metadata.
2. **Structural gate**: inspect keys, literal discriminators, path patterns, and
   required field groups.
3. **Schema gate**: validate against class-specific JSON Schemas.
4. **Rules gate**: evaluate source-specific decisions over extracted facts.
5. **Ontology gate**: verify that the selected class can map to a known graph
   class, graph lane, and IRI pattern.
6. **Conflict gate**: pick the most specific valid class, or quarantine.

The first implementation can be local and simple: AJV schemas plus a source
plugin decision table. External rule engines are optional classifier adapters.

## Deterministic Node.js Options

### AJV

AJV is the first gate. It handles fast JSON Schema validation and can classify
records by trying class-specific schemas in priority order.

Use it for:

- required property signatures
- `const` / `enum` discriminators
- `if` / `then` / `else` source variants
- schema-driven normalization preconditions
- input contract validation before graph projection

### json-rules-engine

`json-rules-engine` is a good fit when rules need to be persisted as JSON and
edited outside TypeScript. It supports nested `all` / `any` conditions and custom
facts.

Use it for:

- source-specific classification rules
- explicit tie breakers
- routing records into graph lanes
- readable evidence from rule names and fact matches

### JSON Logic

JSON Logic is smaller and more portable than a full rules engine. It is useful
for field-level predicates and mapping preconditions.

Use it for:

- "emit this predicate only when..." clauses
- config-embedded predicates
- portable rule snippets shared with other tools

### Decision Tables

A tiny built-in decision table may be better than a dependency for the first
version:

```json
[
  {
    "class": "pokemon",
    "priority": 100,
    "all": [
      { "path": "_type", "equals": "pokemon" },
      { "path": "ndex", "type": "number" }
    ]
  }
]
```

Decision tables give Squashage a stable core, while integrations can later compile
from GoRules, JSON Logic, or json-rules-engine into the same internal plan.

### GoRules / Zen Engine

GoRules is useful if classification becomes business-rule-heavy and decision
tables need a visual editor. It is probably too much for the default core, but
it is a good adapter candidate.

### RDF/JS And The Wrapper Layer

Squashage emits standard RDF/JS terms, quads, and datasets and delegates
every RDF implementation detail to a small `src/rdf/*` and `src/shacl/*`
wrapper layer. RDF/JS is the build's internal canonical product; the
actual output is a single serialized RDF file (see
[`plans/13-file-output-and-semantics-integration.md`](plans/13-file-output-and-semantics-integration.md)).

**v0.x backing of the wrappers** (permissive OSS):

- `DataFactory`, term, and quad construction → `src/rdf/DataFactory.ts`
  over `@rdfjs/data-model`.
- Fluent quad emission inside plugins → `src/rdf/GraphBuilder.ts`
  (vendored from semantics/rdf-builder).
- Format parse/serialize for the output file → `src/rdf/Serializer.ts`
  and `src/rdf/Parser.ts` over `n3` (Turtle/TriG/N-Triples/N-Quads) and
  `jsonld` (JSON-LD via N-Quads bridge).
- Format detection / MIME negotiation → `src/rdf/Formats.ts` (hand-rolled
  table covering the five v0.x formats).
- Canonicalization → `src/rdf/Canonicalize.ts` over `rdf-canonize`.
- IRI building and slugging → `src/rdf/Namespaces.ts` over
  `@rdfjs/namespace` plus vendored `IRIUtils` / `BaseIRIResolver`.
- Vocabulary constants and prefix tables → `src/rdf/Vocab.ts`
  (hand-rolled with `@rdfjs/namespace`).

Application code imports **only** from `src/rdf/*` and `src/shacl/*` —
never `n3`, `jsonld`, `rdf-canonize`, `rdf-validate-shacl`, `@rdfjs/*`,
or any `@semantics/*` package directly. The wrappers' public surfaces
stay stable; v1.x rewrites their bodies against the published
`@semantics/*` workspace and re-enables RDF/XML and N3 output.

Graph-store loading is **not** Squashage's job — run any loader of your
choice on the produced file.

### N3.js Reasoning

N3.js (already a v0.x runtime dep, used inside `src/rdf/*` for
parse/serialize) supports limited deterministic forward inference via its
`Store` + reasoning helpers. Reasoning is not wired into the v0.x
pipeline; v1.x will likely consume `@semantics/n3-reasoner` and
`@semantics/sparql-*-entailment` for the same purpose.

Use it for:

- optional deterministic post-projection inference
- simple subclass or relation completion rules
- compatibility testing against RDF/JS expectations

### SHACL Validation

SHACL validation runs through `src/shacl/ShaclGate.ts` (v0.x backed by
`rdf-validate-shacl`; v1.x by `@semantics/shacl-validator`). It is configured
as a sink-time hook (`validate` on the sink) — failures quarantine the
dataset for that sink rather than aborting the entire build.

Use it for:

- graph shape validation
- required predicate checks
- datatype checks
- IRI-vs-literal checks
- per-sink quarantine reports

### Natural

Natural's Bayes and logistic classifiers can be deterministic if the training
set, tokenizer, stemmer, and model artifact are fixed. They should still be
advisory, not authoritative.

Use it for:

- ranking ambiguous text-heavy records
- suggesting a likely class for unknowns
- generating review queues

Do not use it as the default build gate for canonical RDF/JS output.

## Embeddings

Embeddings are useful for recall and review. They are not classification truth.

Good uses:

- find duplicates across sources with different names
- suggest candidate ontology classes for unknown records
- align messy source fields to known ontology predicates
- cluster quarantined records into batches
- detect "this looks like an existing mapping" opportunities

Output from embedding workflows should be written as proposals:

```json
{
  "source": "quarantine/unknown/foo.json",
  "suggestions": [
    {
      "type": "pokemon",
      "score": 0.84,
      "neighbors": [
        "https://pokemontology.dev/species/bulbasaur"
      ]
    }
  ],
  "status": "needs-review"
}
```

A deterministic rule, schema, or mapping update promotes proposals into the
build. The model suggestion itself does not.

## LLM / Reasoning Assistants

LLMs are helpful for authoring and explanation:

- draft a mapping from a cluster of unknown records
- summarize why SHACL validation failed
- propose a JSON Schema for a source record family
- explain graph conflicts to a human reviewer
- generate test fixtures for new classifier rules

They should not run in `squashage build` unless the user explicitly enables an
advisory mode that writes review artifacts instead of canonical RDF/JS output.

## References

- AJV: <https://github.com/ajv-validator/ajv>
- json-rules-engine: <https://github.com/CacheControl/json-rules-engine>
- JSON Logic: <https://github.com/jwadhams/json-logic-js>
- GoRules: <https://docs.gorules.io/learn/getting-started/what-is-gorules>
- N3.js: <https://github.com/rdfjs/N3.js>
- rdf-validate-shacl: <https://github.com/zazuko/rdf-validate-shacl>
- W3C SHACL: <https://www.w3.org/TR/shacl/>
- W3C OWL: <https://www.w3.org/OWL/>
