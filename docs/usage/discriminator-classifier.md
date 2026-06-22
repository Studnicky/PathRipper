---
layout: doc
title: Discriminator classifier
description: classify:discriminator reads a JSON Pointer from each record and uses the resolved string directly as the class name. Open-world — no enumeration required.
---

# Discriminator classifier

`classify:discriminator` reads a configured JSON Pointer from the record, grabs whatever string is there, and proposes it as the class name. That is the whole recipe. A `_type: "Feat"` becomes a `Feat` proposal at confidence 1.0. A new `_type` value you have never seen before classifies automatically — the discriminator does not need to know your class list up front.

Priority defaults to 50; set it to 80 to beat every enumerative fallback. One field, any domain, no enumeration to maintain.

## Configuration

Wire the discriminator inside `register(dispatcher)` in your plugin's `index.ts`:

```typescript
import { DiscriminatorClassifierNode } from 'squashage/classifiers';

dispatcher.registerNode(new DiscriminatorClassifierNode({
  from:     '/_type',       // JSON Pointer (RFC 6901) into the record
  sanitize: 'pascalCase',   // optional — 'verbatim' | 'pascalCase' | 'kebabToPascal'
  priority: 80,             // optional — defaults to 50
  fallback: '/category',    // optional — second pointer tried when `from` is absent
}));
```

## Field reference

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `from` | string | yes | | JSON Pointer (RFC 6901) into the record. Any non-empty string at this path becomes the proposed class name. |
| `sanitize` | string | no | `'verbatim'` | `'verbatim'` — use the value as-is. `'pascalCase'` — split on `-`, `_`, or whitespace, capitalise each segment. `'kebabToPascal'` — same transform as `pascalCase`. |
| `priority` | number | no | `50` | Written onto the emitted `ClassificationProposal`. Higher wins conflict resolution. |
| `fallback` | string | no | | Pointer evaluated when `from` resolves to undefined or a non-string. |

When the resolved value is an empty string, or when both `from` and `fallback` resolve to nothing, the node outputs `no-match` and no proposal is written.

## Emitted proposal

```json
{
  "source":     "classify:discriminator",
  "className":  "Feat",
  "priority":   80,
  "confidence": 1.0,
  "reasons": [
    "discriminator at \"/_type\" resolved to \"feat\""
  ]
}
```

## Example — plugin registration

```typescript
// plugins/aonprd/index.ts
import { DiscriminatorClassifierNode } from 'squashage/classifiers';
import type { SquashageDagonizer } from 'squashage';

export function register(dispatcher: SquashageDagonizer): void {
  dispatcher.registerNode(new DiscriminatorClassifierNode({
    from:     '/_type',
    sanitize: 'pascalCase',
    priority: 80,
  }));
}
```

With this config, a record carrying `"_type": "monster-family"` is classified as `MonsterFamily`. Add a new `_type` value to the dump, get a new class — no code changes.

## See also

- [Classifier cascade](./classifier-cascade) — full classifier set and conflict resolution.
- [Structural classifier](./structural-classifier) — predicate-based fallback for records without a `_type` field.
- [Configuration](./configuration) — full config reference.
