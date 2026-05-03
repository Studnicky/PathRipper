# Current State

Squashage currently exists as a documentation-first fork of the Ripperoni
workspace.

## Done

- Literal workspace copy from `/Users/studs/Workspace/ripper` to
  `/Users/studs/Workspace/squashage`.
- Package identity changed to `squashage` in `package.json` and
  `package-lock.json`.
- Config examples renamed to `squashage.config*.example.json`.
- README rewritten around graph reconstitution rather than source scraping.
- Architecture and classification-engine docs added.
- Output contract drafted in
  [`13-file-output-and-semantics-integration.md`](13-file-output-and-semantics-integration.md):
  RDF/JS is internal; the build's output is a single serialized RDF file.
  **v0.x ships against permissive open-source libraries** (`n3`, `jsonld`,
  `rdf-canonize`, `rdf-validate-shacl`, `@rdfjs/*`) behind a thin
  `src/rdf/*` + `src/shacl/*` wrapper layer. **v1.x will swap** the wrapper
  bodies to the unpublished `@semantics/*` workspace without touching
  application code. Graph-store loading is out of scope in either version.

## Still Ripperoni Skeleton

These areas are copied and still need intentional migration:

- `src/cli/cli.ts` still exposes scrape/crawl behavior.
- `src/config/RipperConfig.ts` still models Ripperoni source targets.
- `src/orchestrators/ScrapeOrchestrator.ts` still owns web scraping flow.
- `src/scrapers/`, `src/crawlers/`, and scraper built-in tasks are still present.
- `plugins/` are still source-parser examples, not graph squasher plugins.
- `docs/*.html` still describe Ripperoni and should be replaced or regenerated.
- `package.json` does not yet declare the v0.x OSS deps (`@rdfjs/*`, `n3`,
  `jsonld`, `rdf-canonize`, `rdf-validate-shacl`).
- Example configs still use the legacy `output: { type, mode }` shape rather
  than the explicit `output.kind = 'file'` single-output shape.

## Desired First Runtime Shape

```text
json:read
  -> target:classify
  -> target:squash-*
  -> rdfjs:finalize     # orchestrator-driven; serializes the canonical dataset to ONE file via src/rdf/Serializer.ts
```

A target with no `output` block is a config error. The internal RDF/JS
dataset is the build's canonical product, not an output.

## Technical Direction

- Reuse the generic `Pipeline`, `ConcurrentPipeline`, and `TaskRegistry`
  shapes; preserve every Ripperoni code standard verbatim (lint, tsconfig
  strictness, AJV setup, hooks, CI, conventional commits, changelog gate,
  TSDoc density, logger discipline). See plan 13's "Code Standards
  (Inherited From Ripperoni Verbatim)".
- Redefine `PipelineStateInterface` and `PipelineContextInterface` in place
  for the squashage domain (no `Reconstitution*` parallel types).
- Use AJV and local decision tables for deterministic classification.
- Emit RDF/JS quads into a shared canonical dataset using
  `src/rdf/DataFactory.ts` and `src/rdf/GraphBuilder.ts`.
- Output a single serialized RDF file via `src/rdf/Serializer.ts`. v0.x
  formats: turtle, trig, nquads, ntriples, jsonld. v1.x adds rdfxml and n3.
- Run optional canonicalization (`src/rdf/Canonicalize.ts`) and SHACL
  validation (`src/shacl/ShaclGate.ts`) as pre-write hooks.
- Application code imports **only** from `src/rdf/*` and `src/shacl/*` —
  never `n3`, `jsonld`, `rdf-canonize`, `rdf-validate-shacl`, `@rdfjs/*`,
  or any `@semantics/*` package directly. Enforced by ESLint's
  `no-restricted-imports`.
- Never depend on any graph-store backend. Loading the produced file is a
  downstream concern.
- Keep embeddings and LLMs in advisory workflows that produce review
  artifacts, not canonical RDF/JS output or output writes.
