---
layout: doc
title: Getting Started
description: Feed Squashage structured JSON records. It classifies each one, squashes the lot into a deterministic RDF graph, and hands you a single file you can serve.
---

# Getting Started

Squashage takes a pile of JSON records and squashes them into a deterministic RDF graph. Every build is a directed acyclic graph (DAG) executed by [@studnicky/dagonizer](https://github.com/Studnicky/Dagonizer). Two things drive a run: a config file and a plugin.

- **Config** `squashage.config.json` — where the JSON lives, where the graph goes, how many records run at once.
- **Plugin** `plugins/<namespace>/` — the classifiers, the squash node, the per-record DAG. Bring your own; or run bare for a generic rdf:type-only projection.

## Install

```bash
git clone https://github.com/Studnicky/Squashage.git
cd Squashage
npm install
npm run build
```

## Season the config

A config file is one run. The root holds `input`, `output`, and the run knobs directly — nothing else:

```jsonc
{
  "input":  { "basePath": "./input", "format": "json" },
  "output": { "path": "./graphs/out.nq", "format": "nquads" },
  "concurrency": 4,
  "graphs":    { "default": "https://example.org/graph/default" },
  "subjectIri": { "from": "/url", "sanitize": "url-tail" }
}
```

Drop JSON records into `./input/`, point `output.path` at where you want the graph, and you're done seasoning. Full field reference: [Configuration](./usage/configuration).

## Load the plugin

A plugin lives in `plugins/<namespace>/` and exports `register(dispatcher)`. It registers the classifiers and squash node for your domain, and ships its own per-record DAG as a `*.dag.jsonld` file. Full authoring guide: [Plugins](./usage/plugins).

Pass `--plugin <namespace>` to load it:

```bash
npx squashage-dag build \
  --config squashage.config.json \
  --plugin myplugin
```

No plugin? Squashage runs bare: every record lands in the graph as `rdf:type <vocab>Generic`. Good for exploring data before you write classifiers.

## Run it

```bash
npx squashage-dag build \
  --config squashage.config.json \
  --plugin myplugin
```

Three files land at `output.path`:

| File | Contents |
|---|---|
| `<output.path>` | The success graph — every record that made it through. |
| `<output.path-stem>.prov.<ext>` | PROV-O activity quads — one `prov:Activity` per node execution. |
| `quarantine/<bucket>/<id>.json` | One file per failed record, bucketed by failure mode. |

13,653 Pathfinder records in, 1.74M quads out, 0 failures. [Live demo →](./examples/aonprd)

## Plate it

Turn any `.nq` graph into a self-contained, offline, cosmos.gl WebGL browser:

```bash
npx squashage-dag viz \
  --in ./graphs/out.nq \
  --out my-graph
```

Open `my-graph.html` in any browser. No network, no `node_modules`. Ships with a node inspector, physics panel, pause/resume, and per-concept rulebook properties loaded on demand.

## Where to look next

- [Walk-through](./walk-through) — one record's full journey from JSON to quad.
- [Classifier cascade](./usage/classifier-cascade) — ten classifiers, one winner per record.
- [DAG](./usage/pipeline) — the run-scope + per-record DAGs in full.
- [Plugins](./usage/plugins) — `register(dispatcher)` contract, per-record DAG, classifier building blocks.
- [Configuration](./usage/configuration) — every config slot.
- [Architecture](./architecture) — module map + class lineage.
