---
layout: doc
title: Writing a classifier
description: Any ScalarNode that writes to state.proposals and returns proposed or no-match is a classifier. Here is how to build one from scratch.
---

# Writing a classifier

Any `ScalarNode<SquashageRecordState, 'proposed' | 'no-match', SquashageServices>` is a classifier. Write a proposal into `state.proposals[this.name]` and return `proposed`. Find nothing useful? Return `no-match`. That is the full contract.

## Complete working example

A classifier that reads `quality_score` from the record and proposes `Premium` for scores of 80 and above, `Standard` for everything else:

```typescript
// plugins/myplugin/classifiers/QualityClassifierNode.ts
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { SquashageServices }     from 'squashage/services';
import type { SquashageRecordState }  from 'squashage/state';

type Output = 'proposed' | 'no-match';

class QualityClassifierNodeImpl extends ScalarNode<SquashageRecordState, Output, SquashageServices> {
  public readonly name    = 'classify:quality';
  public readonly outputs = ['proposed', 'no-match'] as const;

  get outputSchema() {
    return {
      proposed:   { type: 'object' as const },
      'no-match': { type: 'object' as const },
    };
  }

  protected override async executeOne(
    state:   SquashageRecordState,
    _ctx:    NodeContextType<SquashageServices>,
  ): Promise<NodeOutputType<Output>> {
    const score = state.input['quality_score'];
    if (typeof score !== 'number') return NodeOutputBuilder.of('no-match');

    state.proposals['classify:quality'] = {
      className:  score >= 80 ? 'Premium' : 'Standard',
      confidence: 1,
      source:     'classify:quality',
      priority:   40,
      reasons:    [`quality_score=${String(score)}`],
    };
    return NodeOutputBuilder.of('proposed');
  }
}

export const qualityClassifierNode = new QualityClassifierNodeImpl();
```

## Register in the plugin

`register(dispatcher)` is where the node enters the pipeline:

```typescript
// plugins/myplugin/index.ts
import type { SquashageDagonizer } from 'squashage';
import { qualityClassifierNode }   from './classifiers/QualityClassifierNode.js';

export function register(dispatcher: SquashageDagonizer): void {
  dispatcher.registerNode(qualityClassifierNode);
}
```

## Wire it in the per-record DAG

The classifier only runs if it appears in the record DAG's `classify-all` parallel collect node. Add its name alongside the built-in classifiers in your plugin's `squashage-record.dag.jsonld`:

```jsonc
{
  "@type": "ParallelNode",
  "name":  "classify-all",
  "nodes": [
    "classify:discriminator",
    "classify:url-pattern",
    "classify:quality"   // ← add your classifier here
  ],
  "outputs": { "success": "classify:ontology", "error": "classify:ontology" }
}
```

## Classifier contract

- **Name must be unique.** `this.name` is the key used to write `state.proposals[this.name]`. Two classifiers sharing a name overwrite each other.
- **Always return `proposed` or `no-match`.** No other outputs are valid for a classifier.
- **Write only to your own slot.** Write to `state.proposals[this.name]`. Never write to another classifier's key.
- **`no-match` is a clean exit.** Returning `no-match` without writing a proposal is the correct path when the record does not match. The cascade continues; other classifiers may still fire.

## Priority guidance

| Range | Typical use |
|---|---|
| 70–90 | Primary discriminators (open-world `_type` reads) |
| 40–65 | Domain-specific signals with high confidence |
| 20–39 | Structural / shape fallbacks |
| 10–19 | Weak signals — last resort |

`classify-conflict` picks the highest-priority proposal. When two classifiers tie on priority and propose different classes, the `onConflict` policy decides: `quarantine` routes the record to quarantine; `pickPriority` picks lexicographically.

## See also

- [Classifier cascade](./classifier-cascade) — how proposals resolve to a final classification.
- [Plugins](./plugins) — full plugin authoring contract.
