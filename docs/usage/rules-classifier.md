---
layout: doc
title: Rules classifier
description: classify:rules is a full decision-table classifier — each rule carries a predicate that must pass for the rule to fire. Highest-priority match wins.
---

# Rules classifier

`classify:rules` is a second decision-table stage that runs the same predicate engine as the structural classifier but occupies its own config slot. Wire them both when your structural pass handles simple field-equality checks and you want a separate, higher-fidelity table for overlapping schemas that need compound predicates to disambiguate.

Each rule carries one predicate. A rule fires when the predicate evaluates to `true` against the record. The highest-priority match among all fired rules writes its proposal into `state.proposals['classify:rules']`.

Predicates compile once at construction; the per-record path is a walk over a pre-built AST — no heap allocation on the hot path.

## Configuration

```typescript
import { RulesClassifierNode } from 'squashage/classifiers';

dispatcher.registerNode(new RulesClassifierNode([
  {
    className: 'Equipment',
    priority:  25,
    predicate: {
      all: [
        { path: '/_type', equals: 'equipment' },
        { path: '/bulk',  exists: true },
      ],
    },
    reasons: ['_type=equipment', 'bulk field present'],
  },
  {
    className: 'Weapon',
    priority:  30,
    predicate: {
      all: [
        { path: '/_type', equals: 'equipment' },
        { path: '/damage', exists: true },
      ],
    },
    reasons: ['_type=equipment', 'has damage field'],
  },
]));
```

When both rules fire (a record with `_type=equipment` and a `damage` field), `Weapon` wins at priority 30.

## Predicate operators

The full operator vocabulary is identical to the structural classifier — see [Structural classifier — Predicate operators](./structural-classifier#predicate-operators) for the complete table.

Quick reference:

- `{ path, equals: value }` — deep equality
- `{ path, in: [...] }` / `{ path, notIn: [...] }` — membership
- `{ path, exists: true }` / `{ path, missing: true }` — presence
- `{ path, type: 'string'|'number'|... }` — type check
- `{ path, regex: '^...$' }` — anchored regex (string only)
- `{ path, length: { gte?, lte?, eq? } }` — string or array length
- `{ path, range: { gte?, lte?, gt?, lt? } }` — numeric bounds
- `{ all: [...] }` / `{ any: [...] }` / `{ not: pred }` — composition

## Field reference

| Field | Type | Required | Notes |
|---|---|---|---|
| `className` | string | yes | Proposed class name when the rule fires. |
| `priority` | number | yes | Written onto the proposal. Highest-priority match wins when multiple rules fire. |
| `predicate` | `RawPredicate` | yes | Compiled once at construction. |
| `reasons` | string[] | yes | Written into `proposal.reasons` for traceability. |

## Emitted proposal

```json
{
  "source":     "classify:rules",
  "className":  "Weapon",
  "priority":   30,
  "confidence": 1,
  "reasons":    ["_type=equipment", "has damage field"]
}
```

When no rules fire, the node outputs `no-match`.

## Example — plugin registration

```typescript
// plugins/aonprd/index.ts
import { RulesClassifierNode } from 'squashage/classifiers';
import type { SquashageDagonizer } from 'squashage';

export function register(dispatcher: SquashageDagonizer): void {
  dispatcher.registerNode(new RulesClassifierNode([
    {
      className: 'Armor',
      priority:  30,
      predicate: {
        all: [
          { path: '/_type', in: ['armor', 'shield'] },
          { path: '/ac_bonus', exists: true },
        ],
      },
      reasons: ['armor/shield type with AC bonus'],
    },
    {
      className: 'Weapon',
      priority:  30,
      predicate: {
        all: [
          { path: '/_type', equals: 'weapon' },
          { path: '/damage', type: 'string' },
        ],
      },
      reasons: ['weapon with damage string'],
    },
  ]));
}
```

## See also

- [Structural classifier](./structural-classifier) — same engine, first decision-table stage.
- [Classifier cascade](./classifier-cascade) — full classifier set and priority ordering.
- [Discriminator classifier](./discriminator-classifier) — open-world primary classifier.
