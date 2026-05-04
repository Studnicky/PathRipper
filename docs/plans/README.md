# Squashage — Plans

Squashage v0.x is **shipped**. See [`00-current-state.md`](00-current-state.md)
for what's in the build today, and
[`13-file-output-and-semantics-integration.md`](13-file-output-and-semantics-integration.md)
for the implementation record (file output, classifier cascade,
configuration, AJV schemas, code standards, migration history).

This directory is the project's living plan log: implemented plans are
preserved as record; outstanding work goes here as new plans before any
agent or contributor starts on it.

## Implemented

| Plan | What |
|------|------|
| [13](13-file-output-and-semantics-integration.md) | File output via `@semantics/*`-shaped wrappers (v0.x backed by `n3`/`jsonld`/`rdf-canonize`/`rdf-validate-shacl`/`@rdfjs/*`); orchestrator-driven `rdfjs:finalize`; SHACL pre-write gate; quarantine; AJV-validated config; deterministic classifier menu; per-run `TaskRegistry`. |
| 14 (in plan 13) | Deterministic prefix derivation (`PrefixResolver`) + auto JSON-LD `@context` build (`JsonldContext.build`) + `output.jsonldContext` override; Pathfinder/aonprd e2e suite proving the pipeline with zero hardcoded IRIs. |
| [15](15-graph-viz.md) | Cytoscape graph renderer (vendored, offline) + `squashage viz` CLI subcommand + checked-in `docs/examples/aonprd/{aonprd.jsonld,aonprd.html}` demo. |

The historical Ripperoni-era plans (01–12) covered scraper bugs and
features that no longer apply — Squashage deleted that layer wholesale
during the v0.x migration. They are kept on disk for archaeology but are
no longer actionable.

## Open

| Plan | What |
|------|------|
| _none_ | The next outstanding work (Torreya/Bulbapedia plugin examples; embedding-assisted advisory lane; v1.x swap to the published `@semantics/*` workspace) does not yet have a written plan. Add one here before starting. |

## Out Of Scope

- **Graph-store loading.** Hand the file Squashage produced to whichever
  loader you prefer (Oxigraph, Fuseki, GraphDB, Apache Jena LOAD, etc.).
- **Multi-output fan-out.** One file per build. Re-run with a different
  `--out` for a different format, or use any RDF format converter to
  translate.
- **Probabilistic classification (LLM, embeddings, ONNX) in the build
  path.** All canonical RDF emission is deterministic. Embedding lanes
  may write *advisory* review proposals separately, but never the
  canonical product.
