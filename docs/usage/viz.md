---
layout: doc
title: Viz
---

# Viz

```bash
squashage viz \
  --in ./graphs/mybuild.jsonld \
  --out mybuild.html \
  --title "My Graph"
```

Takes a JSON-LD file, produces a self-contained HTML document with cytoscape inlined. Open it in a browser. No network, no server, no `node_modules`.

## What you get

A three-pane layout:
- **Graph canvas** — cytoscape renders nodes and edges. Pan, zoom, click.
- **Detail sidebar** — click a node to see its IRI, class, and all predicates.
- **Node list** — alphabetical index of all nodes, grouped by class. Click to focus.

## Color scheme

Node color is derived from the class IRI via a hash-to-hue function. Same class IRI → same color across every graph you render with the same version of squashage. The mapping is not configurable and not intended to be — consistency across builds matters more than custom palettes.

Edge color comes from the named graph IRI via the same mechanism. If you have three named graphs, you get three distinct edge colors.

No legend is generated automatically. The node list groups by class label, which serves the same purpose.

## Click interaction

Click a node on the canvas: the detail sidebar shows the node's `@id`, its class IRI (under `@type`), and all outgoing predicate-value pairs. Values that are named nodes are displayed as IRIs. Values that are literals are displayed with their datatype when present.

The same node in the node list is highlighted when you click it on the canvas.

## iframe embedding

The output file is self-contained — no external dependencies. Embed it in another page via `<iframe>`:

```html
<iframe
  src="./mybuild.html"
  width="100%"
  height="600px"
  style="border:none"
></iframe>
```

Serve it standalone from any static file server:

```bash
npx serve .
# or
python3 -m http.server 8080
```

The file is an HTML document, not a VitePress component. It works anywhere a browser can open a local file.

## Vendor bundle

The cytoscape bundle is vendored into the package at `src/viz/vendor/cytoscapeBundle.ts`. It's inlined into every generated HTML file at build time. This is intentional — the point is offline operation.

To refresh the vendor bundle when a new cytoscape version ships:

```bash
npm run viz:refresh-vendor
```

This runs `scripts/refresh-viz-vendor.js`, which downloads the current cytoscape UMD bundle and overwrites `src/viz/vendor/cytoscapeBundle.ts`. After refreshing, rebuild the package (`npm run build`) to pick up the new bundle in subsequent `viz` runs.

## Demo

The Pathfinder/AONPRD graph lives at [examples/aonprd](../examples/aonprd) — built from the fixture in `tests/e2e/aonprd/` via `npm run viz:demo`.

## Related

- [Getting started](../getting-started) — running viz:demo for the first time
- [Output](./output) — JSON-LD output that feeds into viz
