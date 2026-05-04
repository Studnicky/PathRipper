# Plan 13 — File Output And Semantics Integration

This plan supersedes the earlier "Squashage stops at RDF/JS" framing in
`architecture.md` and `classification-engines.md`. RDF/JS is the **internal
canonical product** of the build — the shape every plugin emits into and the
serializer reads from. It is not itself an output.

A Squashage build writes **one serialized RDF file** per run. There are no
graph-store sinks, no fan-out, no multi-output bundles. The output is always
a file in one of the supported formats.

To get the result into a graph store (Oxigraph, Fuseki, GraphDB, anything),
hand the file to whichever loader fits — that is a graph-store concern, not
Squashage's, and arbitrary-RDF loaders already exist.

To produce more than one format, re-run the build with a different `--out`,
or translate a produced file with any RDF format converter. Multi-output is
a graph-tooling workflow, not a Squashage workflow.

### Publishing Posture (v0.x: OSS-only, v1.x: Semantics)

**v0.x ships against the published open-source RDF/JS stack.** The
unpublished `@semantics/*` workspace at `/Users/studs/Workspace/semantics/`
exists as our forward target, but the first npm release of squashage uses
only permissively-licensed packages from the public registry: `n3`,
`jsonld`, `rdf-canonize`, `rdf-validate-shacl`, `@rdfjs/data-model`,
`@rdfjs/dataset`, `@rdfjs/namespace`, `@rdfjs/types`. See "Dependencies To
Add" for pins.

To keep the swap painless at v1.x, every external RDF call site is funneled
through a small set of squashage-owned wrappers under `src/rdf/` and
`src/shacl/`: `Serializer`, `Parser`, `Canonicalize`, `TermGuards`,
`GraphBuilder`, `Namespaces`, `Vocab`, `IRIUtils`, `ShaclGate`. Plugins,
finalize, and the orchestrator import these wrappers — they never import
`n3`, `jsonld`, `rdf-canonize`, etc. directly. When the semantics workspace
publishes, only the wrappers change.

**v0.x format coverage is reduced to five**: Turtle, TriG, N-Triples,
N-Quads, JSON-LD. RDF/XML and N3 *output* are deferred — `n3` does not
write N3, and there is no maintained streaming RDF/XML serializer on npm.
The `output.format` enum drops `rdfxml` and `n3` in v0.x; they return when
the semantics workspace is consumed.

## Boundary Correction

| Concern | Squashage | Semantics |
|---------|-----------|-----------|
| Classification cascade and evidence | owns | — |
| Normalization of source records | owns | — |
| Projection of records into RDF/JS quads | owns | — |
| Pipeline + task registry | owns | — |
| Single-file output dispatch and reporting | owns | — |
| `DataFactory`, `Quad`, `Term` shapes | consumes via `src/rdf/*` wrappers | v0.x: `@rdfjs/types` + `@rdfjs/data-model`. v1.x: `@semantics/rdf-data-model` |
| `DatasetCore` implementation | consumes | v0.x: `@rdfjs/dataset`. v1.x: `Dataset` from `@semantics/rdf-store` |
| Builder ergonomics | consumes via `src/rdf/GraphBuilder.ts` | v0.x: vendored from semantics. v1.x: `@semantics/rdf-builder` |
| Turtle/TriG/N-Triples/N-Quads parse + serialize | consumes via `src/rdf/Parser.ts`, `src/rdf/Serializer.ts` | v0.x: `n3`. v1.x: `@semantics/rdf-io` |
| JSON-LD parse + serialize | consumes via the same wrappers | v0.x: `jsonld`. v1.x: `@semantics/rdf-io` |
| RDF/XML and N3 *output* | **deferred to v1.x** | v0.x: not supported; v1.x: `@semantics/rdf-io` |
| Format detection / MIME negotiation | owns in `src/rdf/Formats.ts` | tiny in-house table in v0.x; v1.x may delegate to `@semantics/rdf-formats` |
| SHACL validation | consumes via `src/shacl/ShaclGate.ts` | v0.x: `rdf-validate-shacl`. v1.x: `@semantics/shacl-validator` |
| RDF syntax validation (per-format, optional post-write sanity) | consumes via `src/rdf/SyntaxValidator.ts` | v0.x: parse round-trip with `n3` / `jsonld`. v1.x: `@semantics/rdf-validator` |
| Canonicalization | consumes via `src/rdf/Canonicalize.ts` | v0.x: `rdf-canonize` (RDFC-1.0 → N-Quads → re-parse). v1.x: `@semantics/rdf-canonicalize` |
| Vocabulary / prefixes (RDF, RDFS, OWL, XSD, SHACL) | owns in `src/rdf/Vocab.ts` | v0.x: hand-rolled with `@rdfjs/namespace`. v1.x: `@semantics/rdf-vocabulary` |
| IRI building, slugging, prefix utilities | owns in `src/rdf/Namespaces.ts` and `src/rdf/IRIUtils.ts` | v0.x: `@rdfjs/namespace` + vendored utils. v1.x: `@semantics/rdf-iri` |
| Reasoning / entailment | optional, advisory | v0.x: not wired. v1.x: `@semantics/n3-reasoner` etc. |
| Graph-store loading | not Squashage's job | downstream tool of the user's choice |
| Format → format translation | not Squashage's job | downstream tool (e.g. `rdf-serialize`, or v1.x `@semantics/rdf-io`) |

Squashage stays out of *parsing*, *storing*, *querying*, and *validating*
implementations.

## RDF/JS Is Internal, Not An Output

The pipeline produces an RDF/JS `DatasetCore` per target. That dataset is the
build's canonical, in-process value. It is:

- the input the file serializer reads from
- the value returned by the programmatic build API for embedded callers
- the structure SHACL/validation runs against before serialization

It is **not** the output the CLI produces. The CLI always serializes to a
file. Embedded callers who only want the dataset call the programmatic API.

```ts
const result = await Squashage.build({ target: 'bulbapedia', config });
// result.dataset      : DatasetCore   (the canonical product)
// result.outputReport : OutputReport  (where the file landed)
// result.quarantine   : QuarantineReport
```

## The Output

One serialized RDF file per build, declared per target. Format defaults from
the file extension via `@semantics/rdf-formats`.

```jsonc
{
  "output": {
    "kind": "file",
    "path": "./out/bulbapedia.trig"
  }
}
```

Supported formats — v0.x supports five, fronted by `src/rdf/Serializer.ts`
which dispatches to `n3.Writer` for the Turtle family and `jsonld.fromRDF`
(through an N-Quads bridge) for JSON-LD. RDF/XML and N3 output return when
v1.x consumes the semantics workspace.

| Format | Format Id | Default Extension | Quads? | v0.x Backend |
|--------|-----------|-------------------|--------|--------------|
| Turtle | `turtle` | `.ttl` | no (default graph only) | `n3.Writer` |
| TriG | `trig` | `.trig` | yes | `n3.Writer` |
| N-Triples | `ntriples` | `.nt` | no | `n3.Writer` |
| N-Quads | `nquads` | `.nq` | yes | `n3.Writer` |
| JSON-LD | `jsonld` | `.jsonld` | yes | `jsonld.fromRDF` (via N-Quads) |
| RDF/XML | `rdfxml` | `.rdf` | no | **v1.x only** (no maintained npm streaming serializer) |
| N3 | `n3` | `.n3` | no | **v1.x only** (`n3` package parses but does not write N3; emit Turtle) |

If the target uses named graphs and a quad-incapable format is requested, the
loader fails fast unless `output.graph` is set to collapse all quads to a
single graph at write time.

Optional output fields:

- `format` — override extension-based detection.
- `mode` — `dataset` (buffer then write, default) or `stream` (pipe quads as
  emitted; cancels canonicalization and whole-dataset SHACL).
- `prefixes` — override prefix table for the serialization.
- `canonicalize: true` — run RDF Dataset Canonicalization
  (`@semantics/rdf-canonicalize`) before write.
- `validate.shapes` — SHACL gate (`@semantics/shacl-validator` via
  `Dataset` from `@semantics/rdf-store` for the data graph) before write;
  failure emits `validation.report.txt` (`formatReport`) and
  `validation.report.ttl` (`toRDF` + `serialize`) under
  `./graphs/<target>/quarantine/output/` and aborts the write.
- `graph` — collapse all quads to a single named graph (use for triple-only
  formats over targets that emit named graphs).
- `dryRun: true` — compute report, no write.

## Output Interface (sketch)

```ts
import type { Quad } from '@rdfjs/types';

export interface OutputInterface {
  readonly path: string;
  readonly format: string;

  open(): Promise<void>;
  write(quad: Quad): Promise<void>;
  writeBatch(quads: Iterable<Quad>): Promise<void>;
  close(): Promise<OutputReportInterface>;
}

export interface OutputReportInterface {
  readonly path: string;
  readonly format: string;
  readonly quadCount: number;
  readonly graphCount: number;
  readonly durationMs: number;
  readonly bytesWritten: number;
  readonly errors: ReadonlyArray<OutputErrorInterface>;
}
```

Implementation lives at `src/output/FileOutput.ts` and uses
`@semantics/rdf-io` for serialization. The `rdfjs:finalize` task instantiates
exactly one `FileOutput`, streams the canonical dataset into it, and returns
the output report.

## CLI Override

The CLI can override the configured output path/format for one-off runs
without editing the config:

```bash
# Use the configured output.
squashage build --target bulbapedia --config squashage.config.torreya.example.json

# Override the path (format inferred from extension).
squashage build --target bulbapedia --out ./graphs/bulbapedia.ttl

# Force a format explicitly.
squashage build --target bulbapedia --out ./graphs/bulbapedia.out --format jsonld

# Dry-run.
squashage build --target bulbapedia --dry-run
```

## Multi-Format And Store-Loading Workflows

Squashage produces one file per run. For more outputs:

1. **Re-run** with a different `--out`. Classification is deterministic, so
   the second run produces the same RDF/JS internally and a second file
   externally.
2. **Translate** between formats with `@semantics/rdf-io`
   (e.g. `rdf-io convert input.trig output.jsonld`).
3. **Load into a store** with `@semantics/rdf-store`
   (e.g. `rdf-store import --to fuseki --url http://... input.trig`).

These translation and load tools work on any RDF document. Reusing them keeps
Squashage out of graph-store and format-fan-out business.

## Failure Policy

The output writes a `OutputReport` to
`./graphs/<target>/output.report.json`. On failure:

- Write a `.partial` artifact next to the target path, plus the report.
- Build fails fast and exits non-zero.
- A pre-write SHACL validation failure quarantines the dataset under
  `./graphs/<target>/quarantine/output/` and records the validation report;
  the build exits non-zero without touching the destination file.

## Streaming vs Dataset Modes

`output.mode` controls how the canonical product is materialized internally:

- `dataset` — buffer all quads into a `DatasetCore`, then serialize to the
  output file. Required for canonicalization and whole-dataset SHACL.
- `stream` — pipe quads through the serializer as plugins emit them.
  Required for very large targets where buffering is not viable. Cancels
  canonicalization and post-projection SHACL.

If `mode = stream` and `canonicalize: true` or whole-graph `validate` is
configured, the loader fails fast with an explicit conflict message.

## Validation Hook

- **Pre-write SHACL** (default off) via `src/shacl/ShaclGate.ts`
  (v0.x: `rdf-validate-shacl`; v1.x: `@semantics/shacl-validator`)
  against shapes declared in the output config. The shapes file is
  loaded with `src/rdf/Parser.ts` so any supported RDF format works for
  the shapes graph. The data graph is the in-process `DatasetCore`
  after canonicalization (when configured). On failure, two reports
  land under `./graphs/<target>/quarantine/output/`:
  `validation.report.txt` and `validation.report.ttl` — see "SHACL
  validation hook" and "Quarantine Emission". The destination path
  stays untouched (no `.partial` file).
- **Post-write syntax sanity** (default off): the produced file may be
  parsed back via `src/rdf/Parser.ts` and validated against the
  format's syntax validator in `src/rdf/SyntaxValidator.ts`. Failure
  means our serializer is broken — fail fast and leave a `.partial`
  alongside.

## Migration Lanes (Replaces "Later" Lanes 09–10)

| Lane | What |
|------|------|
| 13a | Add `output` config block (single file) + AJV schema; require it on every target |
| 13b | Add `OutputInterface`, `OutputReportInterface` |
| 13c | Implement `FileOutput` using `@semantics/rdf-io` |
| 13d | Wire output into `rdfjs:finalize` |
| 13e | Add output report under `./graphs/<target>/output.report.json` |
| 13f | Add `canonicalize` and `validate` hooks |
| 13g | Add `--out` and `--format` CLI overrides |

## Dependencies To Add

Squashage `package.json` should declare:

### v0.x — OSS-only

Pinned to currently-maintained, permissively-licensed packages on npm.
Verified against the registry at the time of this plan.

```jsonc
{
  "dependencies": {
    "@rdfjs/types":        "^2.0.1",   // MIT — type definitions
    "@rdfjs/data-model":   "^2.1.1",   // MIT — DataFactory + term classes
    "@rdfjs/dataset":      "^2.0.2",   // MIT — DatasetCore implementation
    "@rdfjs/namespace":    "^2.0.1",   // MIT — Proxy-based namespace builder
    "n3":                  "^2.0.3",   // MIT — Turtle/TriG/N-Triples/N-Quads/N3 parser; Turtle/TriG/N-Triples/N-Quads writer; in-memory Store
    "jsonld":              "^9.0.0",   // BSD-3-Clause — JSON-LD parse + serialize via N-Quads
    "rdf-canonize":        "^5.0.0",   // BSD-3-Clause — RDFC-1.0 (URDNA2015 successor)
    "rdf-validate-shacl":  "^0.6.5"    // MIT — SHACL over DatasetCore
  }
}
```

No `peerDependencies`. `n3` is a direct dep in v0.x — squashage owns the
serializer dispatcher and uses `n3.Writer` / `n3.Parser` directly inside
`src/rdf/Serializer.ts` and `src/rdf/Parser.ts` (and only there).
Application code (plugins, finalize, orchestrator, classifier) imports
the squashage wrappers, never `n3` directly.

Drop these from `dependencies` in the same edit (orphaned by the scraper
deletion — see "File Inventory" → Delete):

- `bottleneck` — only `src/modules/http/rateLimiter.ts` imports it.
- `cheerio`, `domhandler` — only `src/scrapers/HtmlScraper.ts` imports them.
- `wtf_wikipedia` — only `src/scrapers/WikitextParser.ts` and
  `MediaWikiScraper.ts` import it.

Keep `commander`, `ajv`, `ajv-formats`, `json-schema-to-ts` — they are
still used by the new CLI and config loader.

### v1.x — Semantics workspace swap

When the `@semantics/*` workspace publishes, the dependency block flips to:

```jsonc
{
  "dependencies": {
    "@rdfjs/types":                "^2.0.1",
    "@semantics/rdf-builder":      "^1.0.0",
    "@semantics/rdf-canonicalize": "^1.0.0",
    "@semantics/rdf-data-model":   "^1.0.0",
    "@semantics/rdf-formats":      "^1.0.0",
    "@semantics/rdf-io":           "^1.0.0",
    "@semantics/rdf-iri":          "^1.0.0",
    "@semantics/rdf-validator":    "^1.0.0",
    "@semantics/rdf-vocabulary":   "^1.0.0",
    "@semantics/shacl-validator":  "^1.0.0",
    "@semantics/rdf-store":        "^1.0.0"
  }
}
```

Only the bodies of the `src/rdf/*` and `src/shacl/*` wrapper files change.
Their public surface (`Serializer.serialize`, `Parser.parse`,
`Canonicalize.run`, `ShaclGate.run`, `TermGuards.*`, etc.) stays
identical, so plugins, `rdfjs:finalize`, and `SquashageOrchestrator` do
not need to be rewritten. RDF/XML and N3 *output* re-enter the
`output.format` enum and the supported-formats table when this swap
lands.

> **Boundary rule**: Squashage application code (anything outside
> `src/rdf/` and `src/shacl/`) **must not** `import` from `n3`,
> `jsonld`, `rdf-canonize`, `rdf-validate-shacl`, or any `@semantics/*`
> package. Funnel through the wrappers. ESLint rule-of-thumb in CI: a
> `no-restricted-imports` config can enforce this for the v0.x → v1.x
> migration window.

Graph-store loading is not a Squashage dependency in either v0.x or v1.x.
Loading remains a downstream concern, invoked separately by users on the
file Squashage produced.

## Compatibility Notes (v0.x publishing posture)

- **v0.x ships under permissive OSS dependencies only**: `n3` (MIT),
  `jsonld` (BSD-3-Clause), `rdf-canonize` (BSD-3-Clause),
  `rdf-validate-shacl` (MIT), `@rdfjs/data-model` / `@rdfjs/dataset` /
  `@rdfjs/namespace` / `@rdfjs/types` (all MIT).
- **No `@semantics/*` runtime dependency in v0.x.** The unpublished
  workspace is referenced in this plan only as the v1.x swap target.
- **`output.format` enum is `turtle | trig | ntriples | nquads | jsonld`
  in v0.x.** RDF/XML and N3 output return in v1.x.
- **Application code does not import `n3` / `jsonld` / `rdf-canonize` /
  `rdf-validate-shacl` / `@rdfjs/*` / `@semantics/*` directly.** It
  imports from `src/rdf/*` and `src/shacl/*` only. Enforced by ESLint
  `no-restricted-imports` (see "RDF API Surface → Boundary rule").

## Compatibility Notes (output config)

- The current `output: { type: "rdfjs", mode: "dataset" }` shape is replaced
  by the explicit single-file shape (`output.kind = 'file'`, `path`, optional
  `format`/`mode`/`canonicalize`/`validate`). The first migration step
  rewrites the examples; programmatic callers still receive the in-process
  dataset, but the build no longer treats "rdfjs" as a configured output.
- Plugins do not change. They still call `state.dataset.add(quad)` (or use a
  `@semantics/rdf-builder` builder). Output awareness lives in finalize,
  config, and the report — not in plugin code.

## Code Standards (Inherited From Ripperoni Verbatim)

Squashage was bootstrapped as a literal copy of Ripperoni. **Every
engineering standard from that copy is preserved unchanged.** Dispatched
implementation work must not weaken any of them. Where the migration touches
a file under one of these gates, the new code must satisfy the existing
gate; where the migration deletes a file, the gate's coverage shrinks but
the gate itself stays in place.

### Lint, Format, Type-Check

- `eslint.config.mjs` and `tsconfig.json` are inherited verbatim. Strict
  mode stays on. Do not relax `noImplicitAny`, `strictNullChecks`,
  `noUncheckedIndexedAccess`, or any other strict flag to make migration
  easier.
- `npm run typecheck` (`tsc --noEmit`) must pass on every commit.
- `npm run lint` (`eslint 'src/**/*.ts'`) must pass on every commit.
- `npm run lint:fix` is acceptable as a developer convenience, not as a
  way to suppress rules. New `eslint-disable` / `@ts-ignore` /
  `@ts-expect-error` comments require an explicit one-line reason and a
  diff comment justifying the exception in PR description.
- The `tsconfig.plugins.json` build for the plugin compile keeps working;
  any new plugin TS files compile under it.

### Tests

- Existing test layout is preserved: `tests/unit/`, `tests/integration/`,
  `tests/e2e/`. Run with the existing scripts (`npm run test:unit`,
  `npm run test:integration`, `npm run test:e2e`).
- Test runner stays `node --import tsx --test`. Do not swap test
  frameworks.
- New code lands with new unit tests. Coverage must not regress.
- Integration / e2e tests for new code that exercise the file-output
  pipeline against fixtures from `tests/fixtures/` (mirroring the
  Ripperoni convention) are required before merge.
- `npm run check` (the typecheck + lint + unit umbrella) is the local
  pre-push gate.

### Validations And AJV

- The existing AJV setup (`ajv`, `ajv-formats`, `json-schema-to-ts`) is
  reused for the new config schemas. Schemas live alongside the existing
  ones under `src/schemas/`.
- Schema validation gates the config loader the same way it gates the
  current Ripperoni config loader. The loader fails fast on invalid
  config, and the failure name is an existing
  `ExternalSchemaError` / `RipperConfigError`-style named error.

### Hooks, CI, Conventional Commits, Changelog

- `scripts/install-hooks.sh` runs on `postinstall` and `prepare` — this
  contract stays.
- `.husky/` and `.github/hooks/` keep their existing wiring. New code
  does not bypass `--no-verify`, `--no-gpg-sign`, or `--skip-hooks`.
- The existing CI workflow (matrix CI under plan 10) keeps gating PRs.
  Add new jobs only as additions, never replacements; never remove
  required checks to ship.
- Conventional commit messages remain mandatory. Existing commit message
  hook rules apply unchanged.
- `CHANGELOG.md` is mandatory on every release/hotfix. The changelog
  check stays in CI; if it fails, the entry gets added — the gate is
  not loosened.

### Logger Discipline

- `Logger.forComponent('Foo')` continues to be the entry point. Every
  call passes both `component` and `operation`. `component !== operation`.
- New modules add their own component name; do not piggy-back on an
  existing module's logger.

### Module Conventions

- Strict mode, named exports one per file, static imports at top, DI for
  externals. Same as today.
- `import type` for type-only imports.
- Domain methods over freestanding helpers — factories, parsers,
  builders, accessors, and validators belong on a class. Free
  `createFoo` / `makeFoo` / `parseFoo` are forbidden.
- Static-only utility classes use `private constructor() { /* static-only */ }`
  and `# private` field syntax (see `TaskRegistry`).
- TSDoc on every exported symbol with `@remarks`, `@example`,
  `@category`, `@since`, `@see`, `@group`. Match the existing density
  in `src/registry/TaskRegistry.ts`, `src/types/PipelineState.ts`,
  `src/pipeline/Pipeline.ts`.
- Interface naming: `FooInterface` for interfaces; classes are bare
  `Foo`. No type aliases that rename canonical types — use
  `PipelineStateInterface`, `Quad`, `DatasetCore`, etc. directly.

### Existing Pipeline Machinery Is Preserved

`Pipeline`, `ConcurrentPipeline`, `TaskRegistry`, `TaskFnInterface`,
`NextFnInterface`, `PipelineStateInterface`, and `PipelineContextInterface`
keep their names and their public API shapes. Squashage adapts the *fields*
of those interfaces to the graph-reconstitution domain; it does not
introduce parallel `Reconstitution*` types. `Pipeline` and
`ConcurrentPipeline` keep their generics and their orchestration semantics
unchanged.

### Build And Scripts

- `package.json` scripts retain their meanings: `prebuild`, `build`,
  `build:plugins`, `typecheck`, `lint`, `lint:fix`, `test`, `test:unit`,
  `test:integration`, `test:e2e`, `check`, `dev`, `postinstall`,
  `prepare`. New scripts may be added; existing scripts may not be
  removed or repointed.
- `engines.node >= 24` and `type: module` stay.
- `dist/` is the build artifact root; the `exports` map continues to
  point into `dist/`.

### Migration Discipline

- No `--no-verify`, no `--force`, no `--skip-ci`. If a gate trips, fix
  the underlying cause in code.
- Branch protection on `master` and `develop` is honored. Feature work
  goes through feature branches and PRs; release/hotfix flows match the
  existing convention.
- Pre-push: run `npm run check` locally before pushing. Local green
  before remote green.

## PipelineStateInterface (Squashage shape)

`PipelineStateInterface` and `PipelineContextInterface` keep their existing
names from `src/types/PipelineState.ts`. Their fields adapt to the
graph-reconstitution domain. The interface still extends
`Record<string, unknown>` for free inter-task attachment, and `output` keeps
its role as the per-record result slot.

Modify (not replace) `src/types/PipelineState.ts` to the shape below. Reuse
the existing TSDoc style verbatim.

```ts
import type { DataFactory, DatasetCore, NamedNode } from '@rdfjs/types';
import type { GraphBuilder }       from '../rdf/GraphBuilder.js';
import type { NamespaceBuilder }   from '../rdf/Namespaces.js';
import type { OutputConfigInterface } from '../config/OutputConfig.js';

/**
 * Source metadata for a single Ripperoni JSON record flowing through the pipeline.
 *
 * @remarks
 * Populated by `json:read` from the file path the record was loaded from and
 * from the optional `_source` block embedded in the record itself. Tasks read
 * this to make classification reproducible and to attribute quarantine
 * records back to the record they came from.
 *
 * @category Pipeline
 * @since 2.1.0
 * @see {@link PipelineStateInterface}
 * @group Types
 */
export interface InputSourceInterface {
  /** Ripperoni target id this record came from (e.g. `"bulbapedia"`). */
  readonly target:    string;
  /** Filesystem path the record was loaded from, relative to the run's input root. */
  readonly path:      string;
  /** Ripperoni plugin that produced the record (e.g. `"bulbapedia:parse"`). */
  readonly plugin?:   string | undefined;
  /** Ripperoni schema id the record was validated against upstream, if known. */
  readonly schemaId?: string | undefined;
}

/**
 * Result of the classification cascade for a single record.
 *
 * @remarks
 * Populated by `classify:*` tasks. Preserved verbatim into quarantine reports
 * when a downstream task quarantines the record.
 *
 * @category Pipeline
 * @since 2.1.0
 * @see {@link PipelineStateInterface}
 * @group Types
 */
export interface ClassificationEvidenceInterface {
  /** Final ontology class id (e.g. `"pokemon"`). */
  readonly type:        string;
  /** `0..1` confidence score from the cascade. */
  readonly confidence:  number;
  /** Cascade engine that produced the result (e.g. `"schema+rules"`). */
  readonly engine:      string;
  /** Human-readable evidence reasons in cascade order. */
  readonly reasons:     ReadonlyArray<string>;
  /** Other classes the cascade considered before settling. */
  readonly candidates?: ReadonlyArray<string> | undefined;
}

/**
 * Shared per-run pipeline context populated by the orchestrator before task execution.
 *
 * @remarks
 * Same role as the scraper-era {@link PipelineContextInterface}: built-in
 * tasks (`json:read`, `rdfjs:finalize`) read it; plugin tasks may use it but
 * are not required to. Field is optional on {@link PipelineStateInterface}
 * so existing callers keep working.
 *
 * @example
 * ```ts
 * const ctx: PipelineContextInterface = {
 *   target:  'bulbapedia',
 *   outDir:  './graphs',
 *   config:  { input: './output/bulbapedia' },
 *   factory: dataFactory,
 *   dataset: store.dataset(),
 *   builder: new GraphBuilder('https://pokemontology.dev/'),
 *   graphs:  { species: dataFactory.namedNode('https://pokemontology.dev/graph/universal/species') },
 *   iri:     new NamespaceBuilder('https://pokemontology.dev/'),
 *   output:  outputConfig,
 * };
 * ```
 *
 * @category Pipeline
 * @since 2.1.0
 * @see {@link PipelineStateInterface}
 * @group Types
 */
export interface PipelineContextInterface {
  /** Squashage target identifier from the config. */
  readonly target:  string;
  /** Output base directory; reports and quarantine records land under `<outDir>/<target>/...`. */
  readonly outDir:  string;
  /** Per-target configuration object as supplied by the loaded squashage config. */
  readonly config:  Record<string, unknown>;
  /** Run-wide RDF/JS factory (singleton from `src/rdf/DataFactory.ts`; v0.x backed by `@rdfjs/data-model`). */
  readonly factory: DataFactory;
  /** Run-wide canonical dataset every plugin contributes to. */
  readonly dataset: DatasetCore;
  /** Builder for emitting quads with prefix/IRI conventions. */
  readonly builder: GraphBuilder;
  /** Named-graph IRIs by lane key, from `targets[].graphs`. */
  readonly graphs:  Readonly<Record<string, NamedNode>>;
  /** IRI builder for the target (Proxy returning a NamedNode per property). */
  readonly iri:     NamespaceBuilder;
  /** Resolved output config (merged with CLI overrides). */
  readonly output:  OutputConfigInterface;
}

/**
 * Shared mutable state passed through every task in a single pipeline run.
 *
 * @remarks
 * `output` keeps its role as the per-record result slot — for Squashage this
 * is the projection report (classification + emitted quad count), not the
 * canonical RDF document. Canonical RDF lives on `context.dataset`. Tasks may
 * attach arbitrary extra keys via the `Record<string, unknown>` index
 * signature for inter-task communication.
 *
 * @example
 * ```ts
 * const state: PipelineStateInterface = {
 *   targetId:       'bulbapedia',
 *   source:         { target: 'bulbapedia', path: 'bulbasaur.json' },
 *   input:          { _type: 'pokemon', name: 'Bulbasaur', ndex: 1 },
 *   classification: null,
 *   output:         null,
 * };
 * ```
 *
 * @category Pipeline
 * @since 2.1.0
 * @see {@link PipelineContextInterface}
 * @group Types
 */
export interface PipelineStateInterface extends Record<string, unknown> {
  /** Squashage target identifier from the config. */
  readonly targetId:       string;
  /** Source metadata for the record flowing through the pipeline. */
  readonly source:         InputSourceInterface;
  /** Parsed Ripperoni JSON record. */
  readonly input:          Readonly<Record<string, unknown>>;
  /** Classification result; `null` until a `classify:*` task populates it. */
  classification:          ClassificationEvidenceInterface | null;
  /** Per-record projection report; `null` until `squash:*` writes it. */
  output:                  Record<string, unknown> | null;
  /** Per-run context populated by the orchestrator. */
  context?:                PipelineContextInterface;
}
```

The scraper-era `PipelinePageInterface` is removed in the same edit (its
file is deleted along with the scraper modules; the export drops from
`src/registry/PipelineState.ts`).

## RDF API Surface (v0.x OSS, v1.x Semantics)

Every external RDF import goes through one of squashage's `src/rdf/*` or
`src/shacl/*` wrappers — application code never imports `n3`, `jsonld`,
etc. directly. The table below names the wrapper and shows both the v0.x
OSS backing and the v1.x semantics backing. The wrapper's public surface
does not change between v0.x and v1.x.

| Wrapper | Public surface | v0.x backing | v1.x backing |
|---------|----------------|--------------|--------------|
| `src/rdf/DataFactory.ts` (re-export) | `dataFactory: DataFactory` and `type { DataFactory, NamedNode, Literal, BlankNode, Quad, DefaultGraph } from '@rdfjs/types'` | `import dataFactory from '@rdfjs/data-model'` (default export is a `DataFactory` instance) | `import { dataFactory, DataFactory } from '@semantics/rdf-data-model'` |
| `src/rdf/TermGuards.ts` | `TermGuards.isNamedNode/isLiteral/isBlankNode/isQuad` | hand-rolled (5 LOC, switches on `term.termType`) | `import { TermGuards } from '@semantics/rdf-data-model'` |
| `src/rdf/GraphBuilder.ts` | `class GraphBuilder { constructor(baseIRI: string); ... }` | vendored from `semantics/rdf-builder/src/GraphBuilder.ts` (~120 LOC) | `import { GraphBuilder } from '@semantics/rdf-builder'` |
| `src/rdf/Formats.ts` | `type RDFFormat`, `FILE_EXTENSIONS`, `MIME_TYPES`, `RDF_FORMATS` | hand-rolled frozen tables (5 formats: turtle, trig, ntriples, nquads, jsonld) | `import { ... } from '@semantics/rdf-io'` (will gain `rdfxml`, `n3`) |
| `src/rdf/Serializer.ts` | `Serializer.serialize(quads: Quad[], opts: { format, prefixes?, baseIRI? }): Promise<{ data: string; format: RDFFormat }>` | dispatches: `n3.Writer` for turtle/trig/ntriples/nquads, `jsonld.fromRDF` (via N-Quads bridge) for jsonld | `import { serialize } from '@semantics/rdf-io'` |
| `src/rdf/Parser.ts` | `Parser.parse(text: string, opts: { format }): Promise<{ quads: Quad[] }>` | dispatches: `n3.Parser` for turtle/trig/ntriples/nquads, `jsonld.toRDF` for jsonld | `import { parse } from '@semantics/rdf-io'` |
| `src/rdf/Canonicalize.ts` | `Canonicalize.run(quads: Quad[]): Promise<Quad[]>` | `rdf-canonize.canonize(quads, { algorithm: 'RDFC-1.0' })` returns N-Quads string; round-trip via `n3.Parser({ format: 'N-Quads' })` to get quads back | `canonicalize(quads, { outputFormat: 'dataset' })` from `@semantics/rdf-canonicalize` |
| `src/rdf/SyntaxValidator.ts` | `SyntaxValidator.validate(text, { format }): { ok, errors }` | parse round-trip via `n3.Parser` / `jsonld.toRDF` inside try/catch | `import { Validator, turtleValidator, ... } from '@semantics/rdf-validator'` |
| `src/rdf/Namespaces.ts` | `NamespaceBuilder` type + class, `IRIUtils`, `BaseIRIResolver` | `@rdfjs/namespace`'s `namespace(iri)` Proxy + vendored utilities | `import { NamespaceBuilder, IRIUtils, BaseIRIResolver, STANDARD_PREFIXES } from '@semantics/rdf-iri'` |
| `src/rdf/Vocab.ts` | `RDF`, `RDFS`, `OWL`, `XSD`, `SHACL`, `STANDARD_PREFIXES` | hand-rolled with `@rdfjs/namespace` (5 namespace builders + frozen prefix record) | `import { RDF, RDFS, OWL, XSD, SHACL } from '@semantics/rdf-vocabulary'` |
| `src/rdf/Dataset.ts` | `class SquashageDataset implements DatasetCore` factory + `dataset(quads?: Quad[])` static | wraps `@rdfjs/dataset`'s `datasetFactory.dataset(quads?)` | `import { Dataset } from '@semantics/rdf-store'` |
| `src/shacl/ShaclGate.ts` | `ShaclGate.run(shapes: DatasetCore, data: DatasetCore): Promise<{ conforms, results, reportDataset }>`, `ShaclGate.formatReport(report): string` | `rdf-validate-shacl` `new SHACLValidator(shapes, { factory: datasetFactory }); validator.validate(data)`; `formatReport` rendered from `report.results` | `import { SHACLValidator, formatReport, toRDF } from '@semantics/shacl-validator'` |

### `Serializer.serialize` — public signature (stable across v0.x / v1.x)

```ts
import type { Quad } from '@rdfjs/types';

class Serializer {
  static async serialize(
    quads:   Quad[],
    options: {
      format:    RDFFormat;          // 'turtle' | 'trig' | 'ntriples' | 'nquads' | 'jsonld' (v0.x)
      prefixes?: Record<string, string>;
      baseIRI?:  string;
    },
  ): Promise<{ data: string; format: RDFFormat }>;
}
```

v0.x implementation sketch (call site for `FileOutput`):

```ts
import { Writer } from 'n3';
import jsonld from 'jsonld';
const N3_FORMAT = { turtle: 'Turtle', trig: 'application/trig',
                    ntriples: 'N-Triples', nquads: 'N-Quads' } as const;

if (format === 'jsonld') {
  const nq  = await Serializer.serialize(quads, { format: 'nquads' });
  const doc = await jsonld.fromRDF(nq.data, { format: 'application/n-quads' });
  return { data: JSON.stringify(doc, null, 2), format: 'jsonld' };
}
const writer = new Writer({ format: N3_FORMAT[format], prefixes });
for (const q of quads) writer.addQuad(q);
const data = await new Promise<string>((res, rej) =>
  writer.end((e, r) => e ? rej(e) : res(r)));
return { data, format };
```

### `Canonicalize.run` — public signature (stable)

```ts
class Canonicalize {
  static async run(quads: Quad[]): Promise<Quad[]>;
}
```

v0.x backing (round-trip via N-Quads):

```ts
import * as canonize from 'rdf-canonize';
import { Parser } from 'n3';
const nq = await canonize.canonize(quads, { algorithm: 'RDFC-1.0' });
return new Parser({ format: 'N-Quads' }).parse(nq);
```

v1.x backing collapses to a single call:

```ts
const { canonicalized } = await canonicalize(quads, { outputFormat: 'dataset' });
return canonicalized;
```

### Boundary rule

Application code (anywhere outside `src/rdf/` and `src/shacl/`) imports
**only** from `src/rdf/*` and `src/shacl/*`. Never imports `n3`,
`jsonld`, `rdf-canonize`, `rdf-validate-shacl`, `@rdfjs/data-model`,
`@rdfjs/dataset`, `@rdfjs/namespace`, or any `@semantics/*` package.
Enforced by `eslint`'s `no-restricted-imports`:

```jsonc
"no-restricted-imports": ["error", {
  "paths": [
    { "name": "n3",                  "message": "Use src/rdf/Serializer.ts or src/rdf/Parser.ts" },
    { "name": "jsonld",              "message": "Use src/rdf/Serializer.ts or src/rdf/Parser.ts" },
    { "name": "rdf-canonize",        "message": "Use src/rdf/Canonicalize.ts" },
    { "name": "rdf-validate-shacl",  "message": "Use src/shacl/ShaclGate.ts" },
    { "name": "@rdfjs/data-model",   "message": "Use src/rdf/DataFactory.ts" },
    { "name": "@rdfjs/dataset",      "message": "Use src/rdf/Dataset.ts" },
    { "name": "@rdfjs/namespace",    "message": "Use src/rdf/Namespaces.ts or src/rdf/Vocab.ts" }
  ],
  "patterns": [{ "group": ["@semantics/*"], "message": "v1.x only — application code stays behind src/rdf/* wrappers" }]
}]
```
The wrapper files themselves carry an `eslint-disable-next-line
no-restricted-imports` on the single line that consumes the underlying
package.

### SHACL validation hook

The `validate.shapes` config field on `output` triggers a SHACL gate
between canonicalization and write. Squashage's `src/shacl/ShaclGate.ts`
wrapper isolates the implementation:

```ts
import { ShaclGate } from '../shacl/ShaclGate.js';
import { Parser   } from '../rdf/Parser.js';
import { Dataset  } from '../rdf/Dataset.js';

const shapesText  = await fs.readFile(output.validate.shapes, 'utf8');
const { quads }   = await Parser.parse(shapesText, { format: shapesFormat });
const shapesGraph = Dataset.from(quads);
const dataGraph   = Dataset.from(ctx.dataset);

const report = await ShaclGate.run(shapesGraph, dataGraph);
if (!report.conforms) {
  // emit quarantine artifacts (see "Quarantine Emission") and abort
}
```

v0.x backing of `ShaclGate.run` (`rdf-validate-shacl`):

```ts
import SHACLValidator from 'rdf-validate-shacl';
import type { DatasetCore } from '@rdfjs/types';

export class ShaclGate {
  static async run(shapes: DatasetCore, data: DatasetCore) {
    // NOTE: do NOT pass `{ factory: datasetFactory }` — `SHACLValidator` calls
    // `factory.clownface(...)` and `factory.termMap(...)` and requires a full
    // @rdfjs/environment (DataFactory + DatasetFactory + ClownfaceFactory +
    // NamespaceFactory + TermMapFactory). Passing only @rdfjs/dataset throws
    // `TypeError: this.factory.clownface is not a function` at construct time.
    // Omitting `factory` lets the validator use its bundled defaultEnv. v0.x
    // verified empirically against rdf-validate-shacl 0.6.5.
    const validator = new SHACLValidator(shapes);
    const report    = await validator.validate(data);
    return {
      conforms:      report.conforms,
      results:       report.results,
      reportDataset: report.dataset,                  // W3C SHACL ValidationReport RDF
    };
  }
  static formatReport(r: { results: ReadonlyArray<{ severity?: { value: string },
                                                    focusNode?: { value: string },
                                                    path?:      { value: string },
                                                    message?:   ReadonlyArray<{ value: string }> }> }): string {
    return r.results
      .map(x => `[${x.severity?.value}] ${x.focusNode?.value} ${x.path?.value ?? ''} → ${x.message?.[0]?.value ?? ''}`)
      .join('\n');
  }
}
```

`rdf-validate-shacl` accepts any `DatasetCore` for both shapes and data;
no `QuadStoreSync` adapter is required. v1.x flips the implementation to
`@semantics/shacl-validator`'s `SHACLValidator` (which uses
`QuadStoreSync` — the wrapper handles that with `Dataset` from
`@semantics/rdf-store`); the public surface of `ShaclGate.run` does not
change.

### Quarantine Emission

On `report.conforms === false`, `rdfjs:finalize` emits two artifacts to
`./graphs/<target>/quarantine/output/`:

- `validation.report.txt` — `ShaclGate.formatReport(report)` (human-
  readable summary: severity, focus node, path, message). For CLI logs
  and review.
- `validation.report.ttl` — `Serializer.serialize(Array.from(report.reportDataset),
  { format: 'turtle', prefixes: { sh: 'http://www.w3.org/ns/shacl#', ... } })`
  via the squashage serializer wrapper. Round-trippable W3C SHACL
  ValidationReport RDF.

The destination output file is **not written**; the build exits non-zero
with the two report paths printed to stderr.

The `src/rdf/SyntaxValidator.ts` wrapper remains useful as an *optional*
post-write sanity check (parse the produced file back; confirm round-trip
parses cleanly). It is not the SHACL hook.

## Output Config — AJV Schema

JSON Schema (draft-07) for the `output` block. New file:
`src/schemas/output.schema.json`. Loader uses AJV (already a dep); applies on
every target. Required on every target — a target without `output` is a
config error.

```jsonc
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://squashage.dev/schemas/output.json",
  "title": "Squashage Output Config",
  "type": "object",
  "additionalProperties": false,
  "required": ["kind", "path"],
  "properties": {
    "kind":        { "type": "string", "const": "file" },
    "path":        { "type": "string", "minLength": 1 },
    "format":      { "type": "string",
                     "enum": ["turtle", "trig", "ntriples", "nquads", "jsonld"],
                     "description": "RDF/XML and N3 output are deferred to v1.x — the AJV schema rejects them in v0.x." },
    "mode":        { "type": "string", "enum": ["dataset", "stream"], "default": "dataset" },
    "prefixes":    { "type": "object",
                     "additionalProperties": { "type": "string", "format": "uri" } },
    "baseIRI":     { "type": "string", "format": "uri" },
    "graph":       { "type": "string", "format": "uri",
                     "description": "Collapse all quads to this named graph at write time. Required when target emits named graphs and `format` is triple-only (turtle, ntriples, rdfxml, n3)." },
    "canonicalize":{ "type": "boolean", "default": false },
    "validate":    {
      "type": "object",
      "additionalProperties": false,
      "required": ["shapes"],
      "properties": {
        "shapes": { "type": "string",
                    "description": "Path to a SHACL shapes graph (any RDF format). Loaded via @semantics/rdf-io's `parse`, wrapped in `Dataset` from @semantics/rdf-store, validated by @semantics/shacl-validator before write." }
      }
    },
    "dryRun":      { "type": "boolean", "default": false }
  },
  "allOf": [
    { "if": { "properties": { "mode": { "const": "stream" } } },
      "then": { "properties": {
                  "canonicalize": { "const": false },
                  "validate":     { "not": {} }
                } } }
  ]
}
```

The whole-target schema requires `output`:

```jsonc
{ "$id": "https://squashage.dev/schemas/target.json",
  "type": "object",
  "required": ["input", "pipeline", "output"],
  "properties": {
    "input":          { "type": "string" },
    "pipeline":       { "type": "array", "items": { "type": "string" }, "minItems": 1 },
    "graphs":         { "type": "object",
                        "additionalProperties": { "type": "string", "format": "uri" } },
    "ontology":       { "type": "object" },
    "classification": { "type": "object" },
    "quarantine":     { "type": "object" },
    "concurrency":    { "type": "integer", "minimum": 1, "default": 1 },
    "output":         { "$ref": "https://squashage.dev/schemas/output.json" }
  } }
```

## Pipeline Lifecycle: Orchestrator-Driven Finalize

`Pipeline.execute(state)` and `ConcurrentPipeline.executeAll(states)` are
**strictly per-record** — `Pipeline.execute` returns the same state it
received, and `ConcurrentPipeline.executeAll` is a `Promise.all` fan-out
gated by a `Semaphore` with no per-batch / per-run hooks. There is no
`onRunStart` / `onRunEnd` seam, and adding one would touch every consumer.
The existing scraper orchestrator already uses an established seam to run
non-per-record work: it strips `crawl:list-targets` from the per-record
queue and invokes the registered task once with a terminal `next`
(`src/orchestrators/ScrapeOrchestrator.ts:112` and `:299-300`).

`rdfjs:finalize` adopts the same seam:

- It is registered in `TaskRegistry` under the name `rdfjs:finalize` so it
  remains visible in target-config `pipeline: [...]` arrays and in
  `squashage sinks list` output. Its function shape is the standard
  `TaskFnInterface<PipelineStateInterface>`.
- `SquashageOrchestrator` strips `rdfjs:finalize` from per-record
  `pipelineNames` before constructing the `Pipeline`, exactly like
  `ScrapeOrchestrator` strips `crawl:list-targets`.
- After the final batch's `executeAll` settles, the orchestrator looks up
  the registered finalize task with `TaskRegistry.get('rdfjs:finalize')`
  and invokes it once: `await finalizeTask(async () => {}, runState)`,
  passing a synthetic `PipelineStateInterface` carrying the run-wide
  `PipelineContextInterface` (`ctx.factory`, `ctx.dataset`, `ctx.output`,
  `ctx.outDir`, etc.).
- Inside the finalize task: instantiate one `FileOutput` from
  `ctx.output`, call `open()` → `writeBatch(ctx.dataset)` (or
  canonicalize first when configured) → `close()` to obtain the
  `OutputReport`. Then write `output.report.json` and any pending
  quarantine reports.

This adds zero changes to `Pipeline.ts`, `ConcurrentPipeline.ts`,
`TaskRegistry.ts`, or `types/Pipeline.ts`. Per-record middleware never
touches `FileOutput` — only the drain phase does, after `Promise.all`
resolves at `ConcurrentPipeline.ts:111-123`, which establishes a
happens-before edge from the last `dataset.add` to the first
`writeBatch`.

### Concurrency Hazards And Mitigation

`ConcurrentPipeline` may run up to `concurrency` records in parallel
(`ScrapeOrchestrator.ts:201`; configured via `targets[].concurrency`). The
only structure shared across parallel records is `ctx.dataset`. Standard
RDF/JS `DatasetCore` implementations are **not** documented as
concurrent-safe.

**Plugin contract for squash tasks**: dataset mutations must be performed
in synchronous bursts. A plugin that emits quads must not `await`
between successive `ctx.dataset.add(quad)` calls within a single record.
Async I/O (file reads, HTTP, etc.) must complete *before* the synchronous
add-quads phase begins. Node's single-threaded event loop makes the
synchronous burst safe; interleaving async-then-add-then-async is what
breaks it.

`FileOutput` itself is single-threaded: only the drain phase writes,
sequentially, in one process. No internal lock is required.

## Built-in Task Contracts

Two new built-in tasks ship with Squashage. Plugins build on top of them.
Both follow the existing `TaskFnInterface<ReconstitutionStateInterface>`
shape (see `src/types/Pipeline.ts`).

### `json:read`

New file: `src/tasks/jsonRead.ts`. Registered as `json:read` by
`src/tasks/index.ts`.

Contract:

- Reads the next input record for the target.
- Source is `ctx.config.input` (a directory, single file, or JSONL path).
- Walks `*.json` and `*.jsonl` under a directory; one record per pipeline run.
- Populates `state.input` with the parsed JSON object.
- Populates `state.source` with `{ target, path, plugin?, schemaId? }`,
  reading `_source` from the record if present.
- On parse failure: writes a `quarantine/projection/<id>.json` record via
  `QuarantineWriter` and short-circuits (`return` without `await next()`).
- Empty / non-object record: same quarantine path with reason
  `"json:read: record is not an object"`.

### `rdfjs:finalize`

New file: `src/tasks/rdfjsFinalize.ts`. Registered as `rdfjs:finalize`.

Contract:

- Runs once per *target run*, not per record. The orchestrator places it at
  the end of the pipeline; it inspects `ctx.dataset` (which all per-record
  squash tasks have written into).
- If `ctx.dataset.size === 0`: write an empty serialized document for the
  configured format, plus an `output.report.json` with `quadCount: 0`,
  `graphCount: 0`. Exit code remains 0 unless quarantine is non-empty.
- Resolve the format: `output.format ?? formatForExtension(output.path)`. If
  neither resolves, fail fast with `OutputConfigError`.
- If named graphs present and format is triple-only and `output.graph` is
  unset: fail fast with `OutputConfigError("named graphs require quad format or output.graph")`.
- If `output.validate?.shapes`: load shapes via `@semantics/rdf-validator`,
  validate the dataset, on failure write the validation report to
  `./graphs/<target>/quarantine/output/validation.report.json` and exit
  non-zero without writing the destination file.
- If `output.canonicalize`: run `canonicalize(quads, { algorithm: 'URDNA2015' })`
  before serialization. Mutually exclusive with `mode: "stream"` (the schema
  enforces).
- Serialize via `serialize(quads, options)` from `@semantics/rdf-io`.
- Write atomically: write to `<path>.tmp`, fsync, rename to `<path>`. On
  failure, leave a `<path>.partial` containing whatever was written so far
  (stream mode) or the staged tmp (dataset mode).
- Always write `./graphs/<target>/output.report.json` (success or failure).

Edge cases:

- **Empty default graph + named graphs**: emit only the named graphs.
- **Triple-only format with `output.graph` set**: rewrite every quad's graph
  position to `output.graph` before serialize.
- **Stream mode**: no canonicalization, no whole-dataset SHACL.
  `OutputReport.bytesWritten` is summed from the underlying writer's byte
  counter (Node `Writable` exposes `bytesWritten` for fs streams).
- **Dataset mode with very large datasets**: serialize is a single in-memory
  string; users on huge runs should switch to `mode: "stream"`.

## QuarantineWriter Contract

New file: `src/quarantine/QuarantineWriter.ts`. Singleton-per-run.

Bucket directories under `./graphs/<target>/quarantine/`:

| Bucket | When |
|--------|------|
| `unknown/` | classification did not pick any class |
| `conflicts/` | cascade returned multiple equally specific candidates |
| `projection/` | `json:read` parse failure or a `squash:*` task threw |
| `output/` | `rdfjs:finalize` validation failure |

Record shape `QuarantineRecordInterface`:

```ts
export interface QuarantineRecordInterface {
  readonly id: string;             // SHA-1 of source.path + record index
  readonly target: string;
  readonly bucket: 'unknown' | 'conflicts' | 'projection' | 'output';
  readonly source: InputSourceInterface;
  readonly input: Record<string, unknown> | null;
  readonly classification: ClassificationEvidenceInterface | null;
  readonly candidates?: ReadonlyArray<ClassificationEvidenceInterface>;
  readonly error?: { name: string; message: string; stack?: string };
  readonly timestamp: string;      // ISO 8601
}
```

Filename: `<id>.json` per record; one file per quarantined record. The
`output/` bucket always writes one record (`validation.report.json`) per run
and overwrites it.

Exit codes:

- `0`: every record either projected cleanly or landed in any quarantine
  bucket (`unknown`, `conflicts`, or `projection`). Quarantine is a *graceful*
  path — `json:read` and `classify:*` tasks short-circuit with a quarantine
  write rather than throwing, so the per-record pipeline does not register a
  failure. The build's exit code stays `0`; the quarantine artifacts on disk
  are how the caller learns which records were rejected. (Verified
  empirically by I1's malformed-JSON test case.)
- `1`: a per-record task threw (caught by `ConcurrentPipeline.executeAll`'s
  `failed[]`), OR `rdfjs:finalize` threw (`OutputConfigError` from
  format/named-graph mismatch, `FileOutputError` from atomic-write or SHACL
  validation failure). The orchestrator surfaces these via
  `result.failed > 0` or by letting the finalize error propagate.
- `2`: config / schema / startup error before any record processed (e.g.
  unknown task name in `pipeline:`, missing target, invalid JSON Schema).

The CLI distinguishes "graceful with quarantine" from "all clean" by counting
artifacts on disk, not via the exit code. Operators who want to fail their
build on any quarantine activity should grep
`./graphs/<target>/quarantine/` after the run.

`QuarantineWriter.summary()` returns counts by bucket; `rdfjs:finalize`
includes them in the output report.

## File Inventory

For dispatched implementation. Paths relative to repo root.

### Create

RDF/SHACL wrappers (every external RDF call site funnels through these —
plugins, finalize, orchestrator, classifier never import `n3`, `jsonld`,
etc. directly):

```
src/rdf/DataFactory.ts                             (re-export `dataFactory`; v0.x → `@rdfjs/data-model`)
src/rdf/Dataset.ts                                 (`Dataset.from(quads | DatasetCore)` static; v0.x → `@rdfjs/dataset`)
src/rdf/Formats.ts                                 (`RDFFormat`, `FILE_EXTENSIONS`, `MIME_TYPES`, `RDF_FORMATS`)
src/rdf/Serializer.ts                              (`Serializer.serialize`; v0.x dispatcher over `n3.Writer` + `jsonld.fromRDF`)
src/rdf/Parser.ts                                  (`Parser.parse`; v0.x dispatcher over `n3.Parser` + `jsonld.toRDF`)
src/rdf/Canonicalize.ts                            (`Canonicalize.run`; v0.x → `rdf-canonize` + `n3.Parser` round-trip)
src/rdf/SyntaxValidator.ts                         (per-format parse round-trip; v0.x → `n3` / `jsonld`)
src/rdf/TermGuards.ts                              (static-only term-type guards on RDF/JS terms)
src/rdf/GraphBuilder.ts                            (vendored from semantics/rdf-builder; ~120 LOC)
src/rdf/Namespaces.ts                              (`NamespaceBuilder`, `IRIUtils`, `BaseIRIResolver`; v0.x → `@rdfjs/namespace`)
src/rdf/Vocab.ts                                   (`RDF`, `RDFS`, `OWL`, `XSD`, `SHACL`, `STANDARD_PREFIXES`)
src/shacl/ShaclGate.ts                             (`ShaclGate.run` + `formatReport`; v0.x → `rdf-validate-shacl`)
```

Squashage core:

```
src/orchestrators/SquashageOrchestrator.ts        (mirrors ScrapeOrchestrator's role and TSDoc style)
src/tasks/jsonRead.ts                              (registers `json:read`)
src/tasks/rdfjsFinalize.ts                         (registers `rdfjs:finalize`)
src/tasks/index.ts                                 (side-effect imports for built-ins)
src/output/OutputInterface.ts
src/output/OutputReport.ts
src/output/FileOutput.ts                           (uses `src/rdf/Serializer.ts`)
src/output/FormatResolver.ts                       (extension → `RDFFormat` via `src/rdf/Formats.ts`)
src/quarantine/QuarantineWriter.ts
src/classification/ClassifierInterface.ts
src/classification/AjvClassifier.ts
src/classification/DecisionTableClassifier.ts
src/classification/Cascade.ts
src/config/SquashageConfig.ts                      (typed loader, replaces RipperConfig usage; keeps named-error pattern)
src/config/OutputConfig.ts
src/schemas/output.schema.json
src/schemas/target.schema.json
src/schemas/squashage-config.schema.json
src/errors/OutputConfigError.ts                    (extends BaseError, mirrors RipperConfigError shape)
src/errors/QuarantineError.ts                      (extends BaseError)
```

Tests:

```
tests/unit/rdf/Serializer.test.ts                  (round-trip turtle/trig/nquads/ntriples/jsonld)
tests/unit/rdf/Parser.test.ts
tests/unit/rdf/Canonicalize.test.ts
tests/unit/rdf/Formats.test.ts
tests/unit/rdf/TermGuards.test.ts
tests/unit/rdf/GraphBuilder.test.ts
tests/unit/rdf/Namespaces.test.ts
tests/unit/rdf/Vocab.test.ts
tests/unit/shacl/ShaclGate.test.ts                 (against W3C SHACL test fixtures)
tests/unit/output/FileOutput.test.ts
tests/unit/output/FormatResolver.test.ts
tests/unit/quarantine/QuarantineWriter.test.ts
tests/unit/classification/Cascade.test.ts
tests/unit/tasks/jsonRead.test.ts
tests/unit/tasks/rdfjsFinalize.test.ts
tests/integration/build-trig.test.ts               (end-to-end smoke against fixtures)
tests/fixtures/squashage/...                       (sample ripperoni JSON for tests)
```

### Modify

```
src/types/PipelineState.ts                         redefine `PipelineStateInterface` and `PipelineContextInterface` for the squashage shape (see above); preserve TSDoc style
src/registry/PipelineState.ts                      replace `fromWikiPage` / `fromHtmlUrl` with `fromInput(targetId, source, input)` static; same private-constructor static-only pattern
src/registry/TaskRegistry.ts                       no API change; verify imports compile after PipelineStateInterface field changes
src/pipeline/Pipeline.ts                           no API change
src/pipeline/ConcurrentPipeline.ts                 no API change
src/types/Pipeline.ts                              no API change; ensures `TaskFnInterface<PipelineStateInterface>` compiles
src/cli/cli.ts                                     drop `scrape`/`crawl` subcommands; add `build`, `classify`, `inspect`; add `--out`, `--format`, `--dry-run`; preserve commander setup style
src/config/RipperConfig.ts                         either rename to SquashageConfig.ts or re-export under both names during transition; AJV validation pattern preserved
package.json                                       add `@semantics/*` deps, `@rdfjs/types`, `n3` peer; drop `cheerio`, `wtf_wikipedia`, `domhandler` once their consumers are deleted; do not change scripts, engines, or hook wiring
README.md                                          already corrected
docs/architecture.md                               already corrected
docs/classification-engines.md                     already corrected
docs/plans/README.md                               already corrected
docs/plans/00-current-state.md                     already corrected
squashage.config.example.json                      already corrected
squashage.config.torreya.example.json              already corrected
```

### Delete (with importer evidence verified by ripgrep)

Every entry below has zero importers outside the deleted set, or its
importers are themselves on the delete/modify list and lose the import in
that same step.

```
src/scrapers/HtmlScraper.ts
src/scrapers/MediaWikiScraper.ts
src/scrapers/WikitextParser.ts
src/scrapers/                                       (entire dir)
src/crawlers/LinkLister.ts
src/crawlers/                                       (entire dir)
src/orchestrators/ScrapeOrchestrator.ts
src/types/ScrapeOrchestrator.ts
src/types/HtmlScraper.ts
src/types/MediaWikiScraper.ts
src/types/LinkListerConfig.ts
src/modules/cache/                                  (only consumers are scrapers; ScraperCache.ts confirmed scraper-only)
src/modules/http/rateLimiter.ts                     (only importers: HtmlScraper, MediaWikiScraper, LinkLister)
src/modules/http/retryExecutor.ts                   (only importers: HtmlScraper, MediaWikiScraper, LinkLister)
src/modules/http/errorClassifier.ts                 (only importer: retryExecutor.ts)
src/modules/http/time.ts                            (no TS importers; only referenced from package.json exports)
src/modules/http/                                   (entire dir)
src/types/Http.ts
src/types/ErrorClassifier.ts
plugins/aonprd/                                     (entire dir; only consumers are deleted e2e tests)
plugins/bulbapedia/parse.task.ts                    (only consumers are deleted e2e tests)
tests/e2e/                                          (entire dir: aonprd*, docs-html, wiki-docs — all Ripperoni-era)
tests/unit/scrapers/                                (entire dir)
tests/unit/crawlers/LinkLister.test.ts
tests/unit/orchestrators/ScrapeOrchestrator.test.ts
tests/unit/modules/ScraperCache.test.ts
tests/unit/modules/http/                            (entire dir)
tests/unit/registry/builtinTasks.test.ts            (rebuilds as tests/unit/tasks/*)
tests/unit/config/RipperConfig.test.ts              (adapt → SquashageConfig.test.ts in Modify pass)
docs/architecture.html                              (Ripperoni-era; regenerate later)
docs/index.html
docs/roadmap.html
scrapers/HtmlScraper.js                             (stray compiled artifact at repo root)
scrapers/MediaWikiScraper.js                        (stray compiled artifact at repo root)
scrapers/                                           (root-level dir, not src/scrapers/)
```

Stray compiled `.js` siblings inside `src/scrapers/`, `src/modules/cache/`,
`src/modules/http/`, and `src/modules/logger/` predate the current
`prebuild` clean of `dist/` and serve no purpose — purge them with their
parent directories.

Confirm with the user before deleting (not in earlier inventory): the
Ripperoni example fixtures `examples/docs-scraper/` and
`examples/wiki-docs/`. Both import `src/types/PipelineState.js` (which is
being redefined) and feed deleted e2e tests. Likely target for deletion in
the same pass, but flagged for confirmation.

### `package.json` Cleanup

Drop these stale entries from the `exports` map (they point at deleted
files and would publish broken specifiers):

```
"./LinkLister"
"./HtmlScraper"
"./MediaWikiScraper"
"./WikitextParser"
"./ErrorClassifier"
"./RetryExecutor"
"./RateLimiter"
"./Time"
"./orchestrators/ScrapeOrchestrator"
```

Keep: `./Pipeline`, `./ConcurrentPipeline`, `./Logger`,
`./config/ConfigClamp`, `./RipperConfig` (until renamed to
`./SquashageConfig`), `./errors/*`, `./registry/TaskRegistry`,
`./registry/PipelineState`. Add new exports under `./output/FileOutput`,
`./tasks/jsonRead`, `./tasks/rdfjsFinalize`,
`./orchestrators/SquashageOrchestrator`,
`./quarantine/QuarantineWriter` as those files land.

### Ordering For Incremental Compile

Each step ends green on `npm run typecheck`, `npm run lint`, and
`npm run test:unit` (which runs after the relevant test files in that
step have been added or removed). Cut consumers before producers; the
import graph is `cli.ts → ScrapeOrchestrator → scrapers/* + crawlers/* +
registry/builtinTasks → types/* → modules/cache → modules/http`.

1. **Stub `src/cli/cli.ts`**: replace the `scrape` and `crawl` subcommand
   bodies with `commander` placeholders that throw "not implemented";
   remove imports of `LinkLister`, `ScrapeOrchestrator`, `ScraperCache`.
   Repo still compiles — there are no remaining scraper consumers in
   `cli.ts`.
2. **Delete the test suites that exercise the soon-to-be-deleted
   modules** (entire `tests/e2e/`; `tests/unit/scrapers/`,
   `crawlers/`, `orchestrators/`, `modules/ScraperCache.test.ts`,
   `modules/http/`, `registry/builtinTasks.test.ts`). This removes the
   bulk of the import pressure on scraper modules so the next step
   compiles cleanly.
3. **Delete `src/orchestrators/ScrapeOrchestrator.ts` and
   `src/types/ScrapeOrchestrator.ts`.** Drop the
   `./orchestrators/ScrapeOrchestrator` export from `package.json`.
4. **Modify `src/registry/builtinTasks.ts`** — strip every scraper-bound
   built-in (or delete the file outright; its replacement is `src/tasks/`
   in a later step). At minimum, remove imports from `../scrapers/*`.
5. **Delete `src/scrapers/`, `src/crawlers/LinkLister.ts`, and
   `src/types/LinkListerConfig.ts`.** Drop the `./LinkLister`,
   `./HtmlScraper`, `./MediaWikiScraper`, `./WikitextParser` exports
   from `package.json`.
6. **Modify `src/types/PipelineState.ts`** to the squashage shape
   (`InputSourceInterface`, `ClassificationEvidenceInterface`, the
   redefined `PipelineContextInterface`, the redefined
   `PipelineStateInterface`). Remove `HtmlScraper` / `MediaWikiScraper` /
   `ScraperCache` imports. **Modify `src/registry/PipelineState.ts`** in
   the same step: replace `fromWikiPage` / `fromHtmlUrl` with
   `fromInput(targetId, source, input)`, preserving the
   private-constructor static-only pattern and TSDoc style.
7. **Delete `src/types/HtmlScraper.ts`, `src/types/MediaWikiScraper.ts`.**
   They are now orphans.
8. **Delete `src/modules/cache/`.** Confirmed scraper-only.
9. **Delete `src/modules/http/` module-by-module**:
   `retryExecutor.ts` → `rateLimiter.ts` → `errorClassifier.ts` →
   `time.ts`, plus `src/types/Http.ts` and `src/types/ErrorClassifier.ts`.
   Drop `./RateLimiter`, `./RetryExecutor`, `./ErrorClassifier`, `./Time`
   from `package.json` exports. Remove `bottleneck` from `dependencies`.
10. **Delete `plugins/aonprd/`, `plugins/bulbapedia/`, all
    `docs/*.html`, root-level `scrapers/*.js`, and stray `.js`
    compiled siblings under `src/`.** Confirm with user before deleting
    `examples/docs-scraper/` and `examples/wiki-docs/`.
11. **Add v0.x OSS deps to `package.json`**: `@rdfjs/types`,
    `@rdfjs/data-model`, `@rdfjs/dataset`, `@rdfjs/namespace`, `n3`,
    `jsonld`, `rdf-canonize`, `rdf-validate-shacl`. Add the
    `no-restricted-imports` rule to `eslint.config.mjs` to keep
    application code off the raw OSS packages. Remove `cheerio`,
    `domhandler`, `wtf_wikipedia` from `dependencies` (now orphaned).
    Smoke-test in a throwaway file: import `Writer` from `n3` and
    serialize a trivial quad list — confirms wiring resolves.
12. **Add the RDF/SHACL wrapper layer** under `src/rdf/` and
    `src/shacl/`: `DataFactory.ts`, `Dataset.ts`, `Formats.ts`,
    `Serializer.ts`, `Parser.ts`, `Canonicalize.ts`,
    `SyntaxValidator.ts`, `TermGuards.ts`, `GraphBuilder.ts`,
    `Namespaces.ts`, `Vocab.ts`, `ShaclGate.ts`, plus their unit tests.
    Each wrapper carries `eslint-disable-next-line no-restricted-imports`
    on the single line that consumes the underlying OSS package. After
    this step, `npm run check` is green and the wrapper surface is
    fully implemented.
13. **Add `FormatResolver`, `OutputInterface`, `OutputReport`,
    `FileOutput`** plus their unit tests. `FileOutput` consumes only
    `Serializer` and `Canonicalize` from the wrappers; no `n3` /
    `jsonld` imports.
14. **Add `QuarantineWriter`** plus its unit tests.
15. **Add `json:read` and `rdfjs:finalize` tasks** plus their unit
    tests. `rdfjs:finalize` follows the orchestrator-driven lifecycle
    (see "Pipeline Lifecycle: Orchestrator-Driven Finalize") and uses
    `ShaclGate.run` for the SHACL hook.
16. **Add `SquashageOrchestrator`** and the CLI `build` / `classify` /
    `inspect` commands; `--out`, `--format`, `--dry-run` flags wired to
    the output config.
17. **Land the integration test** that exercises a tiny target
    end-to-end and produces a TriG file under `./graphs/<target>/`.
18. **Add the classifier cascade** (AJV + decision table) plus unit
    tests.
19. **Add Torreya example plugins** under a separate lane.

### v1.x Swap (separate, later release)

When the `@semantics/*` workspace publishes:

1. Replace OSS deps with the `@semantics/*` set (see "Dependencies To
   Add" → v1.x).
2. Rewrite each `src/rdf/*` and `src/shacl/*` wrapper body to call into
   the corresponding `@semantics/*` package; preserve the wrapper's
   public surface verbatim.
3. Add `rdfxml` and `n3` back to `output.format` enum (AJV schema +
   supported-formats table).
4. Run `npm run check` and the integration suite. No application-level
   code changes should be required because the boundary rule kept
   application code on the wrapper surface only.

## Why Use Wrappers Around Either Stack

- **One swap point for v0.x → v1.x.** When the `@semantics/*` workspace
  publishes, only `src/rdf/*` and `src/shacl/*` change. Plugins, the
  finalize task, the orchestrator, the classifier, and config code stay
  put.
- **Single canonical RDF/JS factory and quad shape** across squashage —
  application code sees one `Serializer.serialize(quads, opts)`,
  `Parser.parse(text, opts)`, `Canonicalize.run(quads)`, `ShaclGate.run`,
  and one `dataFactory`. No leak of `n3.Writer` or
  `jsonld.fromRDF` shape into call sites.
- **Format → format translation and graph-store loading stay external.**
  `rdf-serialize` (or v1.x `@semantics/rdf-io`) covers translation;
  arbitrary RDF loaders cover store ingest. Squashage does not
  reimplement either, in either version.
- **Bug fixes and performance improvements in the underlying stack flow
  to every squashage release without changing the application surface.**
- **Squashage stays focused on what it actually adds**: classifying
  Ripperoni JSON deterministically and projecting it into RDF/JS quads,
  then handing one well-formed RDF file to the rest of the toolchain.
