# Squashage — Implementation Lanes

Current state: [`00-current-state.md`](00-current-state.md)

The workspace was created as a literal copy of Ripperoni. These lanes describe
the migration from scraper skeleton to graph reconstitution tool whose output
is a single serialized RDF file. **v0.x** ships against permissive open-source
RDF libraries; **v1.x** swaps in the unpublished `@semantics/*` workspace
without changing the application surface (see plan 13's "Publishing Posture"
and "Compatibility Notes").

## Can Start Now

| Lane | What |
|------|------|
| 01 | Rename public identity: package, CLI, config loader, docs, examples |
| 02 | Add v0.x OSS deps: `@rdfjs/types`, `@rdfjs/data-model`, `@rdfjs/dataset`, `@rdfjs/namespace`, `n3`, `jsonld`, `rdf-canonize`, `rdf-validate-shacl`. Add `no-restricted-imports` ESLint rule to keep application code off raw OSS packages |
| 03 | Redefine `PipelineStateInterface` and `PipelineContextInterface` for the squashage shape (in-place edit of `src/types/PipelineState.ts`) |
| 04 | Add JSON/JSONL input reader tasks |
| 05 | Add deterministic classification interfaces and evidence model |
| 06 | Add the `src/rdf/*` and `src/shacl/*` wrapper layer: `DataFactory`, `Dataset`, `Formats`, `Serializer`, `Parser`, `Canonicalize`, `SyntaxValidator`, `TermGuards`, `GraphBuilder`, `Namespaces`, `Vocab`, `ShaclGate` |
| 07 | Add `output` config block (see plan 13). Require it on every target |
| 08 | Implement `FileOutput` against `src/rdf/Serializer.ts` (v0.x: turtle, trig, nquads, ntriples, jsonld) |
| 09 | Wire `FileOutput` into `rdfjs:finalize` (orchestrator-driven lifecycle); write output report under `./graphs/<target>/output.report.json` |
| 10 | Add canonicalize and SHACL-validate hooks via `src/rdf/Canonicalize.ts` and `src/shacl/ShaclGate.ts` |
| 11 | Add quarantine manifests for unknown, conflict, and projection-failed records |
| 12 | Comprehensive output plan: [`13-file-output-and-semantics-integration.md`](13-file-output-and-semantics-integration.md) |

## Later

| Lane | What |
|------|------|
| 13 | Add Torreya/Bulbapedia example classifier and squasher plugins |
| 14 | Add `--out` and `--format` CLI overrides for one-off runs |
| 15 | Add embedding-assisted advisory workflow for quarantined records |
| 16 | Remove scraper-only modules once replacement tasks exist |
| 17 | **v1.x swap** to `@semantics/*` workspace (rewrite `src/rdf/*` and `src/shacl/*` wrapper bodies; re-enable `rdfxml` and `n3` output formats). No application-code churn. |

## Out Of Scope

- **Graph-store loading** — Oxigraph/Fuseki/GraphDB/LevelDB/Redis ingestion is
  a downstream concern. Run any loader of your choice on the file Squashage
  produced.
- **Multi-output fan-out** — one file per build. Re-run for another, or use
  any RDF format converter to translate.

## Completion Gate

The first usable v0.x release is ready when this command shape works locally
and writes a deterministic, well-formed RDF file:

```bash
squashage build \
  --target bulbapedia \
  --config squashage.config.torreya.example.json \
  --in ./output/torreya/bulbapedia
```

The result should be deterministic RDF/JS quads serialized to one file, with
an output report and quarantine reports for records that cannot be classified
or projected.
