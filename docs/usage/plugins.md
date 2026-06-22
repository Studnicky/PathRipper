---
layout: doc
title: Plugins
description: Squashage plugin system — plugins/<namespace>/index.ts exports register(dispatcher) and owns classifier nodes, OntologyProjectionNode, and per-record DAG files.
---

# Plugins

A plugin registers classifier nodes, the squash node, and a per-record DAG. The framework discovers the plugin by namespace, calls `register(dispatcher)`, and loads the plugin's `*.dag.jsonld` files before the run starts.

## Plugin directory

Plugins live under `plugins/<namespace>/` in the project root:

```
plugins/
  myplugin/
    index.ts              ← entrypoint
    myplugin-record.dag.jsonld  ← per-record DAG definition
    registry.ts           ← optional worker registry
```

## Entrypoint

`plugins/<namespace>/index.ts` exports a single async function:

```ts
export async function register(
  dispatcher: SquashageDagonizer<NodeStateInterface>
): Promise<void>
```

`register()` is called once at startup. It constructs classifier node instances and the `OntologyProjectionNode`, then registers them on the dispatcher. The dispatcher is the same instance used for the full run.

## What `register()` does

1. Builds a `JsonTologyOntology` from core schemas and any plugin-specific leaf schemas.
2. Constructs classifier node instances (`DiscriminatorClassifierNode`, `UrlPatternClassifierNode`, `StructuralClassifierNode`, `ClassifyConflictNode`, etc.) from `@studnicky/squashage/classifiers`.
3. Constructs an `OntologyProjectionNode` with the plugin-built ontology and registers it as the squash node.
4. Registers all nodes on the dispatcher via `dispatcher.registerNode(node)`.

`services.ontology` is always `null` at the framework level. Plugins own their ontology entirely — it is constructed inside `register()` and passed directly to `OntologyProjectionNode`.

## Per-record DAG

`plugins/<namespace>/<namespace>-record.dag.jsonld` is a plugin-authored DAG definition named `squashage:record`. It overrides the framework's built-in minimal DAG and chains the classifiers the plugin registers.

The PluginLoader loads and registers `*.dag.jsonld` files found in the plugin directory in topological order.

## Worker registry (optional)

`plugins/<namespace>/registry.ts` implements `RegistryModuleInterface` to support `--workers <n>`. When `--workers` is set, the dispatcher spawns worker threads; the registry module provides the worker-side node factory.

## Loading

```bash
squashage-dag build --config path/to/squashage.config.json --plugin myplugin
```

The PluginLoader discovers `plugins/myplugin/`, calls `register(dispatcher)`, then registers the plugin's `*.dag.jsonld` files. Without `--plugin`, the run uses the built-in minimal `squashage:record` DAG (json-read → generic squash → end).

## Example plugin

```typescript
// plugins/myplugin/index.ts
import type { SquashageDagonizer } from '../../src/dispatcher/SquashageDagonizer.js';
import type { NodeStateInterface } from '@studnicky/dagonizer';
import { DiscriminatorClassifierNode, ClassifyConflictNode } from '../../src/classifiers/index.js';
import { OntologyProjectionNode } from '../../src/nodes/record/ontologyProjection.js';
import { loadCoreSchemaInputs, loadExtractedSchemaInputs } from '../../src/ontology/coreSchemas.js';
import { JsonTologyOntology } from '../../src/ontology/JsonTologyOntology.js';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));

export async function register(dispatcher: SquashageDagonizer<NodeStateInterface>): Promise<void> {
  const [coreInputs, extractedInputs] = await Promise.all([
    loadCoreSchemaInputs(),
    loadExtractedSchemaInputs(PLUGIN_DIR),
  ]);
  const ontology = await JsonTologyOntology.create({
    baseIRI:  'https://example.org/',
    schemas:  [...coreInputs, ...extractedInputs],
  });
  dispatcher.registerNode(new OntologyProjectionNode(ontology));
  dispatcher.registerNode(new DiscriminatorClassifierNode({ from: '/_type', sanitize: 'pascalCase', priority: 80 }));
  dispatcher.registerNode(new ClassifyConflictNode({ onConflict: 'pickPriority', evidence: true }));
}
```

## Never throw

Per the dagonizer contract, nodes don't throw. Each node catches its own errors, calls `state.collectError(...)`, and routes to the appropriate quarantine output. This keeps a single-record failure from aborting the rest of the fan-out.

## See also

- [DAG](./pipeline) — where classifier and squash nodes sit in the topology.
- [Classifier cascade](./classifier-cascade) — the available classifier building blocks.
- [Output](./output) — how `rdfjs-finalize` serializes the dataset.
- [Provenance](./provenance) — observer hooks that fire around each node.
