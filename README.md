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
       └─ file output (turtle | trig | nquads | ntriples | jsonld | rdfxml | n3)
```

A single build produces one file. Squashage does not load graph stores. To
ingest the file into Oxigraph, Fuseki, GraphDB, or any other store, hand the
file to whichever loader you prefer. Loading is a graph-store concern, not
Squashage's.

The package was bootstrapped as a literal file copy of the Ripperoni
workspace, so the implementation skeleton still contains scraper-era code.
This repository is currently documentation-first: the public shape, config
model, classifier contract, and file-output contract are being defined before
the code is renamed module by module.

## Goals

- Consume Ripperoni JSON output from one file, a directory tree, or JSONL.
- Classify each input record into an ontology type with deterministic evidence.
- Normalize source-specific records into stable graph entities.
- Project records into RDF/JS quads using a small wrapper layer over the
  open-source RDF/JS stack (`@rdfjs/*`, `n3`, `jsonld`, `rdf-canonize`,
  `rdf-validate-shacl`).
- Serialize the canonical dataset to a single RDF file per build run
  (Turtle, TriG, N-Quads, N-Triples, JSON-LD, RDF/XML, or N3).
- Keep uncertain embedding or LLM help outside the default deterministic build.

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
        "bulbapedia:classify",
        "bulbapedia:squash-pokemon",
        "bulbapedia:squash-move",
        "rdfjs:finalize"
      ],
      "graphs": {
        "pokemon": "https://pokemontology.dev/graph/universal/species",
        "moves":   "https://pokemontology.dev/graph/universal/moves",
        "tcg":     "https://pokemontology.dev/graph/tcg/cards"
      },
      "output": {
        "kind": "file",
        "path": "./graphs/torreya/bulbapedia.trig",
        "mode": "dataset",
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

Squashage follows Ripperoni's task-registry pattern: plugins self-register
named async middleware tasks, and the orchestrator builds per-target pipelines
from config.

```ts
import { TaskRegistry } from 'squashage/registry/TaskRegistry';

TaskRegistry.register('bulbapedia:classify', async (next, state) => {
  state.classification = {
    type: String(state.input['_type'] ?? 'unknown'),
    confidence: state.input['_type'] === undefined ? 0.2 : 1,
    reasons: ['input._type'],
  };

  await next();
});

TaskRegistry.register('bulbapedia:squash-pokemon', async (next, state) => {
  if (state.classification?.type !== 'pokemon') {
    await next();
    return;
  }

  const slug = state.iri.slug(String(state.input['name'] ?? state.input['title']));
  const species = `https://pokemontology.dev/species/${slug}`;

  state.dataset.add(state.factory.quad(
    state.factory.namedNode(species),
    state.factory.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
    state.factory.namedNode('https://pokemontology.dev/ontology#Species'),
    state.factory.namedNode('https://pokemontology.dev/graph/universal/species'),
  ));

  await next();
});
```

Plugins emit quads into the shared canonical dataset. The `rdfjs:finalize`
task serializes that dataset to the configured output file via
`src/rdf/Serializer.ts`, runs any configured canonicalization
(`src/rdf/Canonicalize.ts`) and SHACL validation
(`src/shacl/ShaclGate.ts`), and writes the output report.

## Deterministic Classification

The classifier cascade should be deterministic and explainable:

1. Source contract: target ID, source path, Ripperoni plugin name, and schema ID.
2. Structural signatures: required keys, discriminators, URL/title patterns, and
   template names.
3. JSON Schema gates: `const`, `enum`, `required`, `if`/`then`, and
   `unevaluatedProperties` checks.
4. Rule engine decisions: JSON rules over normalized facts.
5. Ontology gates: known IRI lookup, graph lane checks, and subclass checks.
6. Tie-break policy: priority, specificity, source trust, then explicit
   quarantine when conflict remains.

Every final classification should carry evidence:

```json
{
  "type": "pokemon",
  "confidence": 1,
  "engine": "schema+rules",
  "reasons": [
    "input._type == pokemon",
    "required keys present: ndex, types, abilities",
    "matched graph target: universal/species"
  ]
}
```

## Engine Options

Good deterministic candidates for Node.js:

- **AJV** for JSON Schema validation, structural classification gates, and fast
  target-specific input contracts.
- **json-rules-engine** for human-readable `all`/`any` rule trees over extracted
  facts.
- **json-logic-js** for small portable predicates stored as JSON next to mapping
  rules.
- **GoRules / Zen Engine** when decision tables become easier to maintain than
  nested JSON rules.
- **`src/rdf/GraphBuilder.ts` (vendored) + `src/rdf/DataFactory.ts`** for
  emitting canonical RDF/JS quads inside plugins.
- **`src/rdf/Serializer.ts`** (over `n3` + `jsonld`) for serializing the
  finalized dataset to Turtle, TriG, N-Quads, N-Triples, and JSON-LD in
  v0.x (RDF/XML + N3 in v1.x).
- **`src/shacl/ShaclGate.ts`** (over `rdf-validate-shacl`) for SHACL
  validation as a pre-write hook.
- **Natural** Bayes/logistic classifiers only as frozen, deterministic
  advisory rankers; not as authoritative build gates.

The likely first implementation stack is AJV + a tiny local decision-table
runner + the vendored `GraphBuilder` for projection, with
`src/rdf/Serializer.ts` (n3 + jsonld) producing a single output file
end-to-end. External rule engines remain optional classifier adapters
until the mapping language proves it needs them.

## Embeddings And Reasoning

Embeddings help before deterministic classification, not after:

- Suggest candidate ontology classes for messy unknown records.
- Find duplicate entities across sources with different labels.
- Align source field names to ontology predicates.
- Recommend rule additions for records that fall into quarantine.
- Cluster unknown records so humans can add one mapping rule for a batch.

Reasoning engines help after deterministic projection (and run on the
canonical dataset before serialization):

- Infer superclass membership from emitted `rdf:type` triples.
- Complete relation chains such as form -> base species -> generation.
- Detect contradictions through SHACL via `src/shacl/ShaclGate.ts`
  (entailment is out of v0.x scope).
- Explain why a pre-write validation failed.

Default `squashage build` should be reproducible with no model calls. Model
and embedding lanes write proposals, evidence, and review artifacts; a human
or deterministic rule update promotes those proposals into the build.

## Branding

The joke lives in the project language and iconography: ripperoni, sausage,
squashage, squash/eggplant visuals. The exported TypeScript contracts stay
boring and stable so downstream graph code does not inherit the bit.

## References

- AJV: <https://github.com/ajv-validator/ajv>
- json-rules-engine: <https://github.com/CacheControl/json-rules-engine>
- JSON Logic: <https://github.com/jwadhams/json-logic-js>
- GoRules: <https://docs.gorules.io/learn/getting-started/what-is-gorules>
- N3.js (consumed via `src/rdf/Serializer.ts` and `src/rdf/Parser.ts`): <https://github.com/rdfjs/N3.js>
- jsonld.js: <https://github.com/digitalbazaar/jsonld.js>
- rdf-canonize: <https://github.com/digitalbazaar/rdf-canonize>
- rdf-validate-shacl: <https://github.com/zazuko/rdf-validate-shacl>
- @rdfjs/data-model, @rdfjs/dataset, @rdfjs/namespace: <https://github.com/rdfjs-base>
- W3C SHACL: <https://www.w3.org/TR/shacl/>
- W3C OWL: <https://www.w3.org/OWL/>
