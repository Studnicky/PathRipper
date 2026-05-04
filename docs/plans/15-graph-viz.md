# Plan 15 — Cytoscape Graph Renderer + `viz` CLI

**Status**: Implemented (0.2.0)

## Goal

A user opens `docs/examples/aonprd/aonprd.html` in any browser — no internet, no
Node.js, no `node_modules` — and sees the squashage output rendered as an
interactive graph with node coloring, edge labels, a sidebar, and a class legend.

## Why We Vendor

Offline-capability is non-negotiable for a checked-in demo. CDN-sourced scripts
break in air-gapped environments and offline demos. Vendoring the cytoscape bundle
as a TypeScript string constant (`CYTOSCAPE_JS_BUNDLE`) means the rendered HTML
is entirely self-contained: one file, no network.

The cytoscape bundle is in `src/viz/vendor/cytoscapeBundle.ts` — a TypeScript file
that exports a single `string` constant. No runtime import of the `cytoscape` npm
package occurs anywhere in production TypeScript; cytoscape is a `devDependency`
only, used exclusively to source the minified bundle for the refresh script.

## Data Flow

```
squashage build --target aonprd          →  aonprd.jsonld (JSON-LD, compacted)
JsonLdGraph.fromCompactedJsonLd(doc)     →  VizPayloadInterface  (nodes/edges/graphs/prefixes)
GraphRenderer.render(payload, {title})   →  standalone HTML string (434 KB cytoscape + payload)
writeFile(outPath, html)                 →  aonprd.html  (open in any browser)
```

## Components

| File | Role |
|------|------|
| `src/viz/JsonLdGraph.ts` | JSON-LD → `VizPayloadInterface` adapter (pure, no DOM) |
| `src/viz/GraphRenderer.ts` | `VizPayloadInterface` → standalone HTML string |
| `src/viz/vendor/cytoscapeBundle.ts` | Vendored cytoscape 3.33.3 as a TypeScript string export |
| `src/cli/cli.ts` | `squashage viz --in --out --title` subcommand |
| `scripts/build-aonprd-demo.ts` | Produces `docs/examples/aonprd/aonprd.{jsonld,html}` |
| `scripts/refresh-viz-vendor.js` | Reads installed cytoscape, writes `cytoscapeBundle.ts` |
| `docs/examples/aonprd/aonprd.html` | Checked-in demo (open in browser, offline) |

## Refreshing the Vendor Bundle

When cytoscape releases a new version:

```bash
npm install --save-dev cytoscape@<new-version>
npm run viz:refresh-vendor
```

The refresh script (`scripts/refresh-viz-vendor.js`) reads
`node_modules/cytoscape/dist/cytoscape.min.js`, escapes it for TypeScript template
literal embedding (backticks and backslashes), and overwrites `cytoscapeBundle.ts`
with the new version comment and bundle content.

## Label Compaction

`JsonLdGraph.fromCompactedJsonLd` extracts simple string entries from the
document's `@context` as a prefix map (`prefix → base IRI`). All IRIs — node ids,
class IRIs, predicate labels, graph IRIs — are then compacted using
longest-prefix match against this map. This mirrors the approach used by
`JsonldContext.#compactIri` in the squashage RDF pipeline.

## CLI Usage

```bash
# Render an existing JSON-LD to HTML:
squashage viz --in graphs/aonprd.jsonld --out aonprd.html --title "My Graph"

# Rebuild the checked-in demo:
npm run viz:demo
```
