---
layout: doc
title: Schema classifier (AJV)
description: classify:schema compiles per-class JSON Schema validators at construction time and tests each record against them. Highest-priority match wins.
---

# Schema classifier (AJV)

`classify:schema` loads one JSON Schema file per class, compiles each via the run-wide `services.ajv` instance, and tests every record against every compiled validator. Records with stable, well-defined shapes — where the property set reliably distinguishes one class from another — are a natural fit.

Each entry that returns `true` is a candidate. Highest-priority candidate writes its proposal to `state.proposals['classify:schema']`.

## Configuration

Pass the entry list, the shared AJV instance, and the base directory for schema file resolution:

```typescript
import { SchemaClassifierNode } from 'squashage/classifiers';

dispatcher.registerNode(new SchemaClassifierNode(
  [
    { className: 'Feat',   priority: 30, schemaPath: './schemas/Feat.schema.json' },
    { className: 'Spell',  priority: 30, schemaPath: './schemas/Spell.schema.json' },
    { className: 'Weapon', priority: 30, schemaPath: './schemas/Weapon.schema.json' },
  ],
  services.ajv,      // Ajv instance — shared across the run
  schemasBase,       // absolute path; schemaPath entries resolve against it
));
```

Schema files are read synchronously at construction — the constructor throws immediately if any file is missing or the JSON is invalid. The pipeline never starts with a broken schema list.

## Field reference

| Field | Type | Required | Notes |
|---|---|---|---|
| `className` | string | yes | Proposed class name when the schema validates. |
| `priority` | number | yes | Written onto the proposal. Highest-priority match wins when multiple schemas validate. |
| `schemaPath` | string | yes | Path to a JSON Schema file. Resolved against `schemasBase`. |

Constructor arguments:

| Argument | Type | Notes |
|---|---|---|
| `entries` | array | At least one entry required. Construction throws on an empty array. |
| `ajv` | `Ajv` | The run-wide AJV instance from `services.ajv`. |
| `schemasBase` | string | Absolute directory path. `schemaPath` values resolve against it. |

## Emitted proposal

When one or more schemas validate, the highest-priority match writes:

```json
{
  "source":     "classify:schema",
  "className":  "Feat",
  "priority":   30,
  "confidence": 1,
  "reasons":    ["schema:Feat matched"]
}
```

All validating class names appear in `reasons` — the winner's name and every other match that fired:

```json
{
  "reasons": ["schema:ContentEntry matched", "schema:Feat matched"]
}
```

When no schemas validate, the node outputs `no-match`.

## Example — plugin registration

```typescript
// plugins/aonprd/index.ts
import { SchemaClassifierNode } from 'squashage/classifiers';
import { fileURLToPath }         from 'node:url';
import { dirname, resolve }      from 'node:path';
import type { SquashageDagonizer } from 'squashage';
import type { SquashageServices }  from 'squashage/services';

const schemasBase = resolve(dirname(fileURLToPath(import.meta.url)), 'schemas');

export function register(
  dispatcher: SquashageDagonizer,
  services:   SquashageServices,
): void {
  dispatcher.registerNode(new SchemaClassifierNode(
    [
      { className: 'Feat',  priority: 30, schemaPath: './Feat.schema.json' },
      { className: 'Spell', priority: 30, schemaPath: './Spell.schema.json' },
    ],
    services.ajv,
    schemasBase,
  ));
}
```

## See also

- [Classifier cascade](./classifier-cascade) — full classifier set and priority ordering.
- [SHACL shape classifier](./shacl-shape-classifier) — RDF-level shape validation as a classification signal.
- [Structural classifier](./structural-classifier) — lightweight predicate-based alternative.
