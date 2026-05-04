# Current State

Squashage v0.x is implemented and tests pass: 662 unit + 22 integration + 43 e2e, all
gates clean (`npm run check`, `npm run test:integration`). The package
consumes Ripperoni JSON, classifies each record through a configurable
deterministic cascade, projects matched records into RDF/JS quads, and
serializes the canonical dataset to a single RDF file. Graph-store loading
remains out of scope in both v0.x and v1.x.

## What Ships

- **Wrappers** (`src/rdf/*`, `src/shacl/*`): `Formats`, `DataFactory`,
  `TermGuards`, `Namespaces` (+ `IRIUtils`, `BaseIRIResolver`), `Vocab`
  (RDF/RDFS/OWL/XSD/SHACL + `STANDARD_PREFIXES`), `Dataset`, `Parser`
  (n3 + jsonld dispatcher), `Serializer` (n3.Writer + jsonld dispatcher),
  `Canonicalize` (rdf-canonize RDFC-1.0), `SyntaxValidator`,
  `GraphBuilder` (vendored from `semantics/rdf-builder`), `ShaclGate`
  (rdf-validate-shacl). Application code never imports the underlying OSS
  packages directly — enforced by ESLint `no-restricted-imports`.
- **Output layer** (`src/output/*`): `OutputInterface`, `OutputReport`,
  `FormatResolver`, `FileOutput` with atomic write (tmp + fsync + rename),
  optional pre-write canonicalization, optional pre-write SHACL gate that
  emits `validation.report.{txt,ttl}` quarantine artifacts on failure,
  `dryRun`, and `output.graph` collapse for triple-only formats.
- **Quarantine** (`src/quarantine/QuarantineWriter.ts`): four buckets
  (`unknown`, `conflicts`, `projection`, `output`), SHA-1 record IDs,
  `summary()` and `exitCodeFor()` helpers.
- **Config** (`src/config/*`, `src/schemas/*`): AJV-validated
  `SquashageConfig.loadFromFile`, JSON Schemas for `output`, `target`,
  `predicate`, and root config. Cross-validation enforces
  classification-task ↔ config-block presence.
- **Built-in tasks** (`src/tasks/*`): `json:read` (file / JSONL),
  `rdfjs:finalize` (orchestrator-invoked drain-then-finalize),
  `index.ts` side-effect bootstrap.
- **Classification cascade** (`src/classification/*`): six idiomatic task
  classes — `SourceClassifier`, `StructuralClassifier`, `RulesClassifier`,
  `SchemaClassifier` (over `AjvClassifier` engine), `OntologyClassifier`,
  `ConflictResolver` — instantiated per-target by `ClassificationFactory`.
  Closed-vocabulary `Predicate` engine consumed by Structural and Rules.
- **Orchestrator** (`src/orchestrators/SquashageOrchestrator.ts`):
  builds a fresh per-run `TaskRegistry`, walks the input source
  recursively, drives `ConcurrentPipeline.executeAll`, strips
  `rdfjs:finalize` from the per-record queue and invokes it once after
  the final batch settles, returns `RunResultInterface`.
- **CLI** (`src/cli/cli.ts`): `build`, `classify`, `inspect`, `viz`.
  `build` honors `--out`, `--format`, `--in`, `--dry-run` overrides;
  `viz --in <jsonld> --out <html>` renders a JSON-LD output as a
  self-contained interactive cytoscape graph.
- **Prefix derivation + auto JSON-LD context**
  (`src/classification/PrefixResolver.ts`, `src/rdf/JsonldContext.ts`):
  resolves instance/graph/vocabulary prefix-base pairs from
  `targets[].ontology.prefixes` if present, otherwise derives from
  `_source.url` host + target name; auto-builds the JSON-LD `@context`
  from the produced quad set + `ctx.prefixes` (predicate datatype
  inference, `@container: @set` for multi-valued properties, `@type: @id`
  for IRI-typed object properties). `output.jsonldContext` override is
  optional; default is auto-build.
- **Graph viz** (`src/viz/`): `JsonLdGraph` adapter + `GraphRenderer`
  emitting a standalone HTML document with the vendored cytoscape
  bundle. Demo at `docs/examples/aonprd/aonprd.html` opens in any
  browser, runs offline.
- **Integration tests** (`tests/integration/`): `build-trig.test.ts`
  (full pipeline smoke, malformed-record quarantine, SHACL pass/fail)
  and `build-classify-cascade.test.ts` (full classifier menu).
- **End-to-end test** (`tests/e2e/aonprd.test.ts`): 43 explicit
  assertions over 12 Pathfinder/aonprd fixtures (feat / spell / monster
  / action / equipment + quarantine triggers). The e2e config has zero
  hardcoded IRIs — proves `PrefixResolver` + auto-context end-to-end
  against realistic input.

## Runtime Shape

```text
json:read
  -> classify:source         (optional)
  -> classify:structural     (optional)
  -> classify:rules          (optional)
  -> classify:schema         (optional)
  -> classify:ontology       (optional)
  -> classify:conflict       (required when ≥2 class-proposers are listed)
  -> <target>:squash-*       (user-supplied plugin tasks)
  -> rdfjs:finalize          (orchestrator-driven; runs once per target run)
```

Exit codes: `0` for clean runs and graceful quarantine paths; `1` when a
per-record task throws or `rdfjs:finalize` fails (output, validation,
write); `2` for config / schema / startup errors. Quarantine artifacts on
disk are how the caller learns which records were rejected — exit code is
not the signal.

## What's Next

- **v1.x swap**: replace the OSS wrapper bodies with `@semantics/*`
  imports once that workspace publishes. Re-enable `rdfxml` and `n3`
  output formats. No application-code churn — the wrapper boundary is the
  swap point.
- **Plugin examples**: Torreya/Bulbapedia squashers as a separate lane.
- **Embedding-assisted advisory lane**: produces review proposals for
  quarantined records; never writes canonical RDF/JS.

See [`13-file-output-and-semantics-integration.md`](13-file-output-and-semantics-integration.md)
for the full plan, including the Deterministic Classifier Menu, AJV
schemas, and v0.x → v1.x migration steps.
