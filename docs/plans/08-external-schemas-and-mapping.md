# Lane 08 — External User Schemas + Mapping Engine

**Status:** Ready (depends on Lane 04 for AJV plumbing)
**Effort:** ~6h
**Deps:** Lane 04 (AJV + json-schema-to-ts already wired), Lane 07 (neutral examples)

---

## Principle

> Internal schemas are ours and ship with the package. External schemas (the shape of
> a target's output) come from the user. Ripperoni validates both, but never names a
> target.

Three layers:

1. **Internal schemas** (in `src/schemas/internal/*.schema.ts`, derived TS types via `json-schema-to-ts`):
   - `ripper-config.schema` — the top-level `ripperoni.config.json` shape
   - `target-definition.schema` — meta-schema every target record must satisfy
   - `scraped-page.schema` — canonical envelope every scraper emits internally
   - `run-manifest.schema` — per-run output metadata (`./output/<targetId>/manifest.json`)

2. **User-supplied target definition** (lives inside `ripperoni.config.json` under
   `targets.<id>` and/or `mediawiki.<id>`):
   - `kind`: `"html" | "mediawiki" | "crawler"`
   - `outputSchema`: filesystem path or URL to the user's JSON Schema
   - `extraction`: per-kind extraction rules (selectors / wikitext fields / regex set)
   - `mapping`: declarative projection from `ScrapedPage.raw` into the user's schema

3. **User-supplied output schema** (a JSON Schema file the user owns):
   - Loaded at startup, compiled with AJV, cached by absolute path or URL
   - Each emitted record validated against it before write

## Component layout

```
src/schemas/internal/
  RipperConfigSchema.ts         (Lane 04)
  TargetDefinitionSchema.ts
  ScrapedPageSchema.ts
  RunManifestSchema.ts
  index.ts                      barrel — re-exports schema + derived type + validator
src/mapping/
  MappingEngine.ts              compileMapping() / project() — class-owned, no free fns
  TemplateParser.ts             parses "{{ field | filter:arg | filter }}"
  FilterRegistry.ts             registered filter set (see below)
src/loaders/
  ExternalSchemaLoader.ts       load + compile + cache user schemas (path or https URL)
```

### Filter set (initial)

| Filter         | Effect                                          |
|----------------|-------------------------------------------------|
| `trim`         | `String.prototype.trim`                         |
| `lower`        | `toLowerCase`                                   |
| `upper`        | `toUpperCase`                                   |
| `text`         | strip HTML, collapse whitespace                 |
| `truncate:N`   | first N chars + ellipsis if longer              |
| `hash`         | sha256 hex (stable IDs from URLs)               |
| `join:sep`     | join an array using `sep`                       |
| `default:val`  | fallback if value is `null`/`undefined`/`""`    |

Filters live in a registry on `FilterRegistry` (private constructor + static `register` / `apply`); pipeline accepts user-registered filters via config in a future lane.

### Pipeline integration

A new pipeline task `validateAndProject` runs after `scrape` and before `exportJson`:

```
scrape → ScrapedPage envelope (internal-schema-validated)
       → validateAndProject (project via mapping, validate against user schema)
       → exportJson (write per-page file + update manifest)
```

`onSchemaError` policy in target config: `"halt"` (default) | `"skip"` | `"warn"`.

## User-facing example (target-neutral)

```jsonc
{
  "output": { "basePath": "./output" },
  "targets": {
    "<your-target>": {
      "kind": "html",
      "baseUrl": "https://example.com",
      "rateLimitMs": 500,
      "outputSchema": "./schemas/<your-target>.schema.json",
      "onSchemaError": "halt",
      "extraction": {
        "selectors": {
          "title": "h1.entry-title",
          "body":  "article .content",
          "tags":  { "selector": "a.tag", "many": true, "attr": "textContent" }
        }
      },
      "mapping": {
        "id":      "{{ url | hash }}",
        "name":    "{{ title | trim }}",
        "summary": "{{ body | text | truncate:280 }}",
        "tags":    "{{ tags }}"
      }
    }
  }
}
```

The user's `./schemas/<your-target>.schema.json` is theirs to define and is never
referenced by name in this repo.

## Acceptance criteria

- [ ] `src/schemas/internal/` contains the four schemas, each with a corresponding `*Interface` derived via `FromSchema`
- [ ] No raw `interface` declaration duplicates a schema's shape — types come from schemas
- [ ] `MappingEngine`, `TemplateParser`, `FilterRegistry`, `ExternalSchemaLoader` are classes (not free functions); follow the "domain module methods" rule
- [ ] User schema loader supports both `file:` paths and `https:` URLs and caches compiled validators by canonical key
- [ ] On schema validation failure: error message names target, page id/url, and the specific field path that failed
- [ ] No real target name appears in any new file (Lane 07 grep gate covers this)
- [ ] Unit tests: `MappingEngine`, `FilterRegistry`, `ExternalSchemaLoader`, `validateAndProject` pipeline task
- [ ] Integration test: load a fixture user schema, project a fixture envelope, validate output, write file, validate manifest
- [ ] `npm run check` passes
