---
layout: doc
title: Plugins
---

# Plugins

A squasher plugin is a file that calls `TaskRegistry.register` at module load time. The orchestrator loads the file, the registration fires as a side effect, and the task is available under its name.

## Squasher plugin signature

```ts
type TaskFnInterface<TState> = (next: () => Promise<void>, state: TState) => Promise<void>
```

The task receives `next` (call it when you're done) and `state` (the pipeline state for the current record). Tasks are async. Call `await next()` at the end, not the beginning.

## What state.context provides

```ts
state.context.factory   // RDF/JS DataFactory — namedNode, literal, quad, blankNode
state.context.dataset   // DatasetCore — the shared dataset; add quads here
state.context.builder   // GraphBuilder — helpers for common quad patterns
state.context.iri       // NamespaceBuilder — Proxy; ctx.iri.MyClass → NamedNode
state.context.prefixes  // PrefixResolutionInterface — instances/graphs/vocabulary bases
state.context.graphs    // Record<string, NamedNode> — named-graph nodes by lane key
state.context.output    // OutputConfigInterface — the resolved output config
state.context.config    // Record<string, unknown> — the full target config object
```

`state.classification` gives you the winning class: `.type` (className string), `.confidence`, `.engine`, `.reasons`.

`state.input` is the raw parsed JSON record.
`state.source` is the `_source` metadata block from the record.

## Using GraphBuilder

`GraphBuilder` wraps the factory with helpers for common patterns. Prefer it over raw `factory.quad(...)` for prefix-aware IRI construction:

```ts
const { builder, prefixes } = ctx;
// builder.triple(s, p, o) — adds to default graph
// builder.quad(s, p, o, g) — adds to named graph
// builder.literal(value, datatype?) — literal with optional datatype IRI
```

## Using NamespaceBuilder

`ctx.iri` is a Proxy. Property access returns a `NamedNode` for the vocabulary IRI:

```ts
const featClass = ctx.iri.Feat;           // NamedNode('https://squashage.dev/vocabulary/aonprd#Feat')
const namePred  = ctx.iri['aonprd-name']; // NamedNode('https://squashage.dev/vocabulary/aonprd#aonprd-name')
```

## Using PrefixResolver

`ctx.prefixes` gives you the three base IRIs derived from `_source.url`:

```ts
prefixes.instances.base  // 'https://squashage.dev/instance/aonprd/'
prefixes.graphs.base     // 'https://squashage.dev/graph/aonprd/'
prefixes.vocabulary.base // 'https://squashage.dev/vocabulary/aonprd#'
```

Concatenate to build IRIs: `prefixes.instances.base + urlPath`.

## Full minimal plugin

Projects one input class into one quad per record:

```ts
import { TaskRegistry } from 'squashage/registry/TaskRegistry';
import type { PipelineStateInterface } from 'squashage/types/PipelineState';

TaskRegistry.register('myproject:squash', async (next, state: PipelineStateInterface) => {
  const ctx = state.context;
  if (ctx === undefined || state.classification === null) {
    await next();
    return;
  }

  const { factory, dataset, prefixes } = ctx;

  // Derive subject IRI from source URL path
  const urlPath = new URL(state.input['url'] as string).pathname.slice(1);
  const subject  = factory.namedNode(`${prefixes.instances.base}${urlPath}`);

  // Named graph for this class
  const graph = factory.namedNode(`${prefixes.graphs.base}${state.classification.type}`);

  // rdf:type
  const RDF_TYPE = factory.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
  const classIri = factory.namedNode(`${prefixes.vocabulary.base}${state.classification.type}`);
  dataset.add(factory.quad(subject, RDF_TYPE, classIri, graph));

  // A string property
  if (typeof state.input['name'] === 'string') {
    dataset.add(factory.quad(
      subject,
      factory.namedNode(`${prefixes.vocabulary.base}name`),
      factory.literal(state.input['name']),
      graph,
    ));
  }

  // A numeric property with datatype
  if (typeof state.input['level'] === 'number') {
    dataset.add(factory.quad(
      subject,
      factory.namedNode(`${prefixes.vocabulary.base}level`),
      factory.literal(String(state.input['level']), factory.namedNode('http://www.w3.org/2001/XMLSchema#integer')),
      graph,
    ));
  }

  await next();
});
```

Save this to `plugins/myproject/squash.ts`, build it with your tsconfig, and declare the compiled path in your config's `plugins[]` array.

## Classifier plugins

A classifier plugin registers a task under a `classify:*` name and emits `ClassificationProposalInterface` objects onto `state.classifications`.

When to write one: you have a classification source that doesn't fit the built-in operators — an external lookup table, a flag file, a custom field format — and you want it to participate in the standard conflict resolution.

Shape your proposals emit:

```ts
interface ClassificationProposalInterface {
  source:     string;   // your task name, e.g. 'classify:myproject'
  className:  string;   // the class you're proposing
  priority:   number;   // higher = wins in conflict resolution
  confidence: number;   // deterministic classifiers emit 1.0
  reasons:    string[]; // human-readable evidence
}
```

```ts
import { TaskRegistry } from 'squashage/registry/TaskRegistry';

TaskRegistry.register('classify:myproject', async (next, state) => {
  // Your classification logic here
  const className = state.input['myfield'] === 'foo' ? 'myClass' : null;
  if (className !== null) {
    state.classifications = [
      ...state.classifications,
      {
        source:     'classify:myproject',
        className,
        priority:   25,
        confidence: 1,
        reasons:    ['myfield=foo'],
      },
    ];
  }
  await next();
});
```

List `classify:myproject` in the pipeline after the other classifiers and before `classify:conflict`.

## Guards

Check both `ctx` and `state.classification` before using them. `ctx` is set by the orchestrator but not by unit tests that run tasks in isolation. `state.classification` is `null` until `classify:conflict` runs — your squasher task runs after it, but defensive checks are cheaper than debugging a null dereference.

## Related

- [Pipeline](./pipeline) — how tasks are registered and run
- [Configuration](./configuration) — declaring plugins in the config
- [Classifier cascade](./classifier-cascade) — built-in classify:* tasks and the proposal shape
