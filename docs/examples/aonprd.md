---
layout: doc
title: Pathfinder/AONPRD Demo
description: Interactive WebGL graph of 196,648 Pathfinder Second Edition records from Archives of Nethys — nodes coloured by RDF class, edges resolved to canonical entities by the href-reconcile enrichment pipeline. Produced by the Squashage pipeline.
---

# Pathfinder/AONPRD Graph Demo

An interactive WebGL graph of Pathfinder Second Edition (Archives of Nethys) data produced by the squashage pipeline with href-reconcile entity resolution.

Nodes are coloured by RDF class (feat, spell, monster, action, ancestry, …). Edges connect canonical entities — `rarity`, `trait`, `links`, `family_links` — all resolved to `squashage.dev/instance` targets. Click any node to see its rulebook properties (level, traits, rarity, book/page, edicts, …) and named neighbors. The canvas is zoomable and pannable.

<iframe
  src="/Squashage/examples/aonprd/aonprd.html"
  style="width:100%;height:80vh;border:0;border-radius:4px;"
  title="Pathfinder/AONPRD graph demo"
></iframe>

---

To regenerate this demo from N-Quads output:

```bash
squashage viz --in ./graphs/aonprd/aonprd.nq --out docs/public/examples/aonprd
```

To run the full pipeline from the fixture data (classification → projection → entity resolution → viz):

```bash
squashage build --config plugins/aonprd/aonprd.run.config.json
squashage viz --in ./graphs/aonprd/aonprd.nq --out docs/public/examples/aonprd
```

The standalone HTML file (`docs/public/examples/aonprd/aonprd.html`) runs entirely offline — no network access, no Node.js, no `node_modules` required at display time. Open it directly in any browser.
