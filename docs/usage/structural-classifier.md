---
layout: doc
title: Structural classifier
description: classify:structural evaluates compiled JSON-pointer predicates against each record and proposes a class when a rule fires.
---

# Structural classifier

`classify:structural` runs a decision table of predicate rules against each record. Every rule carries a JSON Pointer predicate; when the record satisfies it, the rule fires and the classifier proposes that rule's class. Highest-priority winner takes the `state.proposals['classify:structural']` slot.

Reach for structural when your records lack a dedicated `_type` field but have a reliably-shaped property you can test. Predicates compile once at construction; the per-record path is pure CPU — a walk over a pre-built AST.

## Configuration

```typescript
import { StructuralClassifierNode } from 'squashage/classifiers';

dispatcher.registerNode(new StructuralClassifierNode([
  {
    className: 'Feat',
    priority:  20,
    predicate: { path: '/_type', equals: 'feat' },
    reasons:   ['_type=feat'],
  },
  {
    className: 'Spell',
    priority:  20,
    predicate: { path: '/_type', equals: 'spell' },
    reasons:   ['_type=spell'],
  },
]));
```

## Predicate operators

Each rule's `predicate` is a `RawPredicate` — a closed vocabulary of 13 leaf operators plus 3 compositional forms:

| Operator | Shape | Passes when |
|---|---|---|
| `equals` | `{ path, equals: value }` | resolved value deep-equals `value` |
| `notEquals` | `{ path, notEquals: value }` | resolved value does not equal `value` |
| `in` | `{ path, in: [v1, v2] }` | resolved value is in the array |
| `notIn` | `{ path, notIn: [v1, v2] }` | resolved value is not in the array |
| `exists` | `{ path, exists: true }` | path resolves to any value (including null) |
| `missing` | `{ path, missing: true }` | path does not exist in the record |
| `type` | `{ path, type: 'string'\|'number'\|'boolean'\|'object'\|'array'\|'null' }` | resolved value is the named JS type |
| `regex` | `{ path, regex: '^...$' }` | string at path matches the anchored regex |
| `length` | `{ path, length: { gte?, lte?, eq? } }` | string or array length satisfies the constraint |
| `range` | `{ path, range: { gte?, lte?, gt?, lt? } }` | number at path satisfies the bounds |
| `all` | `{ all: [pred1, pred2] }` | every nested predicate passes (AND; empty → true) |
| `any` | `{ any: [pred1, pred2] }` | at least one nested predicate passes (OR; empty → false) |
| `not` | `{ not: pred }` | nested predicate does not pass |

Compound predicates compose with `all`/`any`/`not`:

```typescript
{
  className: 'MagicWeapon',
  priority:  25,
  predicate: {
    all: [
      { path: '/_type',   equals: 'weapon' },
      { path: '/traits',  type:   'array' },
      { path: '/traits',  length: { gte: 1 } },
    ],
  },
  reasons: ['_type=weapon', 'has traits array'],
}
```

## Field reference

| Field | Type | Required | Notes |
|---|---|---|---|
| `className` | string | yes | Proposed class name when the rule fires. |
| `priority` | number | yes | Written onto the proposal. Highest-priority match wins when multiple rules fire. |
| `predicate` | `RawPredicate` | yes | Compiled once at construction. Evaluated per record. |
| `reasons` | string[] | yes | Written into `proposal.reasons` for traceability. |

## Emitted proposal

When at least one rule fires, the highest-priority match writes:

```json
{
  "source":     "classify:structural",
  "className":  "Feat",
  "priority":   20,
  "confidence": 1,
  "reasons":    ["_type=feat"]
}
```

When no rules fire, the node outputs `no-match` and no proposal is written.

## Example — plugin registration

```typescript
// plugins/aonprd/index.ts
import { StructuralClassifierNode } from 'squashage/classifiers';
import type { SquashageDagonizer } from 'squashage';

export function register(dispatcher: SquashageDagonizer): void {
  dispatcher.registerNode(new StructuralClassifierNode([
    {
      className: 'Feat',
      priority:  20,
      predicate: { path: '/_type', equals: 'feat' },
      reasons:   ['_type=feat'],
    },
    {
      className: 'Equipment',
      priority:  20,
      predicate: {
        all: [
          { path: '/_type', notIn: ['feat', 'spell', 'monster'] },
          { path: '/bulk',  exists: true },
        ],
      },
      reasons:   ['not feat/spell/monster', 'has bulk field'],
    },
  ]));
}
```

## See also

- [Classifier cascade](./classifier-cascade) — full classifier set and conflict resolution.
- [Rules classifier](./rules-classifier) — same predicate engine, separate config slot for a second decision stage.
- [Discriminator classifier](./discriminator-classifier) — primary open-world classifier.
