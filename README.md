# Squashage

Squashage is the companion package to Ripperoni.

Ripperoni rips source material into structured JSON. Squashage squashes those
records back together into classified RDF: it classifies each record, projects
it into RDF/JS quads, and writes those quads to **a single serialized RDF
file** for the build run.

```text
source site/wiki/API
  -> ripperoni
  -> JSON records
  -> squashage
       (classify -> normalize -> RDF/JS quads -> serialized file)
       └─ file output (v0.x: turtle | trig | nquads | ntriples | jsonld
                       v1.x: adds rdfxml, n3)
```

A single build produces one file. Squashage does not load graph stores. To
ingest the file into Oxigraph, Fuseki, GraphDB, or any other store, hand the
file to whichever loader you prefer. Loading is a graph-store concern, not
Squashage's.

v0.x is implemented and tests pass: 557 unit + 22 integration. The package
was bootstrapped as a literal file copy of Ripperoni and migrated module by
module — the scraper layer is gone; the classification cascade,
output pipeline, AJV-validated config, and CLI are in. See
[`docs/plans/00-current-state.md`](docs/plans/00-current-state.md) for the
component inventory and
[`docs/plans/13-file-output-and-semantics-integration.md`](docs/plans/13-file-output-and-semantics-integration.md)
for the implementation record.

## Goals

- Consume Ripperoni JSON output from one file, a directory tree, or JSONL.
- Classify each input record into an ontology type with deterministic evidence.
- Normalize source-specific records into stable graph entities.
- Project records into RDF/JS quads using a small wrapper layer over the
  open-source RDF/JS stack (`@rdfjs/*`, `n3`, `jsonld`, `rdf-canonize`,
  `rdf-validate-shacl`).
- Serialize the canonical dataset to a single RDF file per build run
  (v0.x: Turtle, TriG, N-Triples, N-Quads, JSON-LD; v1.x adds RDF/XML
  and N3 once the `@semantics/*` workspace publishes).
- Run a deterministic, declaratively configured classifier cascade
  (no probabilistic models in the build path).
- Keep embedding and LLM help out of canonical RDF emission entirely —
  they may produce *advisory* review artifacts in future lanes.

## Non-Goals

- Squashage does not scrape web pages. Ripperoni owns source acquisition.
- Squashage does not treat LLM output as authoritative classification.
- Squashage does not hide graph identity behind opaque generated IDs.
- Squashage does not vendor RDF parsers or serializers — it consumes them
  from `n3` and `jsonld` through a thin internal `src/rdf/` wrapper.
- Squashage does not load graph stores. Loading is a downstream concern;
  point your loader of choice at the file Squashage produced.
- Squashage does not fan out a build across multiple outputs. One build, one
  file. Re-run with a different `--out` for a different format, or use any
  RDF format converter to translate.

## Package Family

**v0.x ships against permissive open-source RDF libraries**:

- `@rdfjs/types`, `@rdfjs/data-model`, `@rdfjs/dataset`, `@rdfjs/namespace`
  — RDF/JS terms, DataFactory, DatasetCore, namespace builder.
- `n3` — Turtle / TriG / N-Triples / N-Quads parse + serialize.
- `jsonld` — JSON-LD parse + serialize (via N-Quads bridge).
- `rdf-canonize` — RDFC-1.0 canonicalization.
- `rdf-validate-shacl` — SHACL validation over `DatasetCore`.

Application code (plugins, finalize, orchestrator, classifier) imports
**only** from squashage's `src/rdf/*` and `src/shacl/*` wrappers, never
from the OSS packages directly. The wrappers present a single small
surface (`Serializer.serialize`, `Parser.parse`, `Canonicalize.run`,
`ShaclGate.run`, `Dataset`, `dataFactory`, etc.) so v1.x can swap the
underlying stack to the unpublished `@semantics/*` workspace without
touching application code.

**Format coverage in v0.x**: Turtle, TriG, N-Triples, N-Quads, JSON-LD.
RDF/XML and N3 *output* are deferred to v1.x (no maintained streaming
RDF/XML serializer on npm; `n3` does not write N3).

Graph-store loading is not a Squashage dependency in either version.
Loading is downstream of the file Squashage produces.

## CLI Sketch

```bash
# Ripperoni produces the chopped ingredients.
ripperoni scrape \
  --target bulbapedia \
  --config ripperoni.config.json \
  --out ./output

# Squashage rebuilds them into graph sausage and writes one file.
squashage build \
  --target bulbapedia \
  --config squashage.config.json \
  --in ./output/bulbapedia

# Override the configured output path/format for a one-off run.
squashage build --target bulbapedia --out ./graphs/bulbapedia.ttl

# Dry-run (compute report, no write).
squashage build --target bulbapedia --dry-run

# Useful inspection commands.
squashage classify --target bulbapedia --in ./output/bulbapedia
squashage inspect --target bulbapedia --in ./output/bulbapedia
```

To produce another format, re-run with a different `--out`. To load into a
graph store, hand the produced file to the loader of your choice
(`rdf-store`, `tpf-server`, raw SPARQL `LOAD`, etc.).

Programmatic consumers receive the in-process RDF/JS `DatasetCore` as the API
return value alongside the output report. The dataset is the build's
internal canonical product; the file is the actual output.

## Config Sketch

```jsonc
{
  "input": {
    "basePath": "./output",
    "format": "json"
  },
  "targets": {
    "bulbapedia": {
      "input": "./output/bulbapedia",
      "pipeline": [
        "json:read",
        "classify:source",
        "classify:structural",
        "classify:rules",
        "classify:ontology",
        "classify:conflict",
        "bulbapedia:squash-pokemon",
        "bulbapedia:squash-move",
        "rdfjs:finalize"
      ],
      "graphs": {
        "pokemon": "https://pokemontology.dev/graph/universal/species",
        "moves":   "https://pokemontology.dev/graph/universal/moves",
        "tcg":     "https://pokemontology.dev/graph/tcg/cards"
      },
      "classification": {
        "source": true,
        "structural": [
          { "className": "pokemon", "priority": 10,
            "predicate": { "path": "/_type", "equals": "pokemon" },
            "reasons": ["_type=pokemon (structural)"] }
        ],
        "rules": [
          { "className": "pokemon", "priority": 20,
            "predicate": { "all": [
              { "path": "/_type", "equals": "pokemon" },
              { "path": "/ndex",  "type": "number" }
            ] },
            "reasons": ["_type=pokemon", "ndex present"] }
        ],
        "ontology": {
          "classes": {
            "pokemon": "https://pokemontology.dev/ontology#Species"
          }
        },
        "conflict": {
          "onConflict": "quarantine",
          "onUnknown":  "quarantine",
          "evidence":   true
        }
      },
      "output": {
        "kind":         "file",
        "path":         "./graphs/torreya/bulbapedia.trig",
        "mode":         "dataset",
        "canonicalize": true
      }
    }
  }
}
```

Format defaults from the file extension via `src/rdf/Formats.ts`. Every
target must declare an `output` block. The full output contract lives in
[`docs/plans/13-file-output-and-semantics-integration.md`](docs/plans/13-file-output-and-semantics-integration.md).

## Pipeline Contract

Squashage follows Ripperoni's task-registry pattern: tasks are async
middleware over `PipelineStateInterface`, and the orchestrator builds a
per-target `Pipeline` from `targets[].pipeline`. Built-in tasks
(`json:read`, `rdfjs:finalize`, the six `classify:*` cascade tasks)
self-register at module load. Custom tasks (squashers, target-specific
classifiers) register the same way.

```ts
import { TaskRegistry } from 'squashage/registry/TaskRegistry';

TaskRegistry.register('bulbapedia:squash-pokemon', async (next, state) => {
  if (state.classification?.type !== 'pokemon') {
    await next();
    return;
  }

  const ctx     = state.context!;
  const slug    = ctx.iri.slug(String(state.input['name'] ?? state.input['title']));
  const species = ctx.factory.namedNode(`https://pokemontology.dev/species/${slug}`);

  ctx.dataset.add(ctx.factory.quad(
    species,
    ctx.factory.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
    ctx.factory.namedNode('https://pokemontology.dev/ontology#Species'),
    ctx.graphs['pokemon'] ?? ctx.factory.defaultGraph(),
  ));

  await next();
});
```

`state.classification` is populated by `classify:conflict` after the
upstream cascade tasks emit proposals into `state.classifications` —
plugins read it but do not write it. Plugins emit quads into
`ctx.dataset`. The `rdfjs:finalize` task serializes that dataset to the
configured output file via `src/rdf/Serializer.ts`, runs any configured
canonicalization (`src/rdf/Canonicalize.ts`) and SHACL validation
(`src/shacl/ShaclGate.ts`), and writes `output.report.json` next to it.

## Deterministic Classifier Menu

Squashage offers six classifier task classes. Targets pick which to use
by listing them in `pipeline:`. Each task is an idiomatic class
instantiated per-target with its frozen, AJV-validated config at run
startup.

| Task | Required config block | Role |
|------|-----------------------|------|
| `classify:source`     | `classification.source: true`     | Reads `_source` metadata; emits a `__source__` marker proposal. |
| `classify:structural` | `classification.structural[]`     | Predicate-based structural gate. |
| `classify:rules`      | `classification.rules[]`          | Predicate-based decision table over normalized facts. |
| `classify:schema`     | `classification.schemas[]`        | Per-class JSON Schema validation via pre-compiled AJV. |
| `classify:ontology`   | `classification.ontology.classes` | Validates proposed classNames against a known IRI map. |
| `classify:conflict`   | `classification.conflict`         | Picks winner by priority desc + className lex asc; quarantines on tie/unknown. |

Cross-validation at config-load enforces "if you list a `classify:*`
task in `pipeline:`, its matching config block must be present and
non-empty"; pipelines listing ≥2 distinct class-proposing classifiers
must end with `classify:conflict`. Misconfigured targets fail fast with
exit code `2` before any record processes.

The predicate vocabulary consumed by `classify:structural` and
`classify:rules` is closed and AJV-validated against
`src/schemas/predicate.schema.json`: `equals`, `notEquals`, `in`,
`notIn`, `exists`, `missing`, `type`, `regex` (must be anchored),
`length`, `range`, plus `all`/`any`/`not` composition. Paths are RFC
6901 JSON Pointers.

The final `state.classification` carries evidence:

```json
{
  "type": "pokemon",
  "confidence": 1,
  "engine": "classify:rules,classify:structural",
  "reasons": [
    "_type=pokemon (structural)",
    "_type=pokemon",
    "ndex present"
  ]
}
```

See [`docs/classification-engines.md`](docs/classification-engines.md)
for the engine details, the rationale behind the closed vocabulary, and
the considered alternatives that did not ship.

## Engines In Use

Application code consumes these wrappers; the OSS packages they sit on
are listed under "Package Family" above.

- **`src/rdf/DataFactory.ts`** + **`src/rdf/GraphBuilder.ts`** —
  RDF/JS factory and fluent quad builder for plugins.
- **`src/rdf/Serializer.ts`** — single output dispatcher (Turtle, TriG,
  N-Triples, N-Quads, JSON-LD).
- **`src/rdf/Parser.ts`** — same five formats; used to load shapes
  graphs and as a round-trip syntax check.
- **`src/rdf/Canonicalize.ts`** — RDFC-1.0 canonicalization on the
  pre-write path when `output.canonicalize: true`.
- **`src/rdf/SyntaxValidator.ts`** — optional post-write syntax sanity.
- **`src/shacl/ShaclGate.ts`** — pre-write SHACL hook with
  `validation.report.{txt,ttl}` quarantine emission on non-conformance.
- **AJV** — config validation (every schema under `src/schemas/`) and
  the engine inside `classify:schema`.
- **`src/classification/predicates/Predicate.ts`** — closed-vocabulary
  predicate engine for `classify:structural` and `classify:rules`.

Plugins remain a custom escape hatch: register a task with `TaskRegistry`
and list it in `pipeline:`. The cascade tasks above cover the
config-driven cases; custom plugins handle target-specific projection
and any niche normalization.

## Embeddings And Reasoning

`squashage build` runs zero model calls. Embeddings and LLMs are
authoring tools — they help draft rules, summarise SHACL failures, and
suggest mappings for quarantined records, but their output is never the
canonical product. A future advisory lane writes proposals next to the
quarantine artifacts; a human or a deterministic config update is what
ever promotes a proposal into the build.

SHACL validation runs through `src/shacl/ShaclGate.ts` as a pre-write
hook. Forward inference and entailment are out of v0.x scope; v1.x may
consume `@semantics/n3-reasoner` and `@semantics/sparql-*-entailment`
once they publish.

## Branding

The joke lives in the project language and iconography: ripperoni, sausage,
squashage, squash/eggplant visuals. The exported TypeScript contracts stay
boring and stable so downstream graph code does not inherit the bit.

## References

- AJV: <https://github.com/ajv-validator/ajv>
- N3.js (consumed via `src/rdf/Serializer.ts` and `src/rdf/Parser.ts`): <https://github.com/rdfjs/N3.js>
- jsonld.js: <https://github.com/digitalbazaar/jsonld.js>
- rdf-canonize: <https://github.com/digitalbazaar/rdf-canonize>
- rdf-validate-shacl: <https://github.com/zazuko/rdf-validate-shacl>
- @rdfjs/data-model, @rdfjs/dataset, @rdfjs/namespace: <https://github.com/rdfjs-base>
- W3C SHACL: <https://www.w3.org/TR/shacl/>
- W3C OWL: <https://www.w3.org/OWL/>

## Demo

Open [`docs/examples/aonprd/aonprd.html`](docs/examples/aonprd/aonprd.html) in
any browser to see the package's JSON-LD output rendered as an interactive graph.
Nodes are coloured by RDF class, edges show object-property links, and clicking
a node reveals its properties in the sidebar. The file runs entirely offline —
no network access, no Node.js, no `node_modules` required at display time.

To rebuild the demo from the fixture data:

```bash
npm run viz:demo
```

To render any squashage JSON-LD output as a standalone HTML graph:

```bash
squashage viz --in ./graphs/aonprd.jsonld --out aonprd.html --title "My Graph"
```
