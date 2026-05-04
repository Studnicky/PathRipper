---
layout: home
title: Squashage
hero:
  name: Squashage
  text: Squashes JSON into graph sausage.
  tagline: Feed it structured JSON records. It classifies each one, reconstitutes the lot into a deterministic RDF graph, and squashes the result into a single file you can actually serve — Turtle, TriG, N-Triples, N-Quads, or JSON-LD. Or open the demo offline; the eggplant is already in the page.
  image:
    src: /squashage.png
    alt: Squashage
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Live demo
      link: /examples/aonprd/aonprd.html
      target: _blank
    - theme: alt
      text: GitHub
      link: https://github.com/Studnicky/Squashage
features:
  - title: Same JSON in, same graph out
    details: Six idiomatic classifier task classes — source, structural, rules, schema, ontology, conflict — with a closed-vocabulary predicate language. No Math.random, no Date.now, no network after startup. Deterministic byte-for-byte across runs and machines.
  - title: One file, no fan-out
    details: A single build produces one serialized RDF file. Auto-derived instance/graph/vocabulary IRIs from _source.url. Auto-built JSON-LD @context from the produced quad set. To get a different format, re-run with a different --out.
  - title: Open the demo offline; the graph is already in the page
    details: The squashage viz CLI emits a single self-contained HTML document with cytoscape inlined. Open it in any browser — no network, no node_modules, no eggplant allergies required.
---
