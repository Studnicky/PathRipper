# Lane 04 — Config Runtime Validation

**Status:** Ready
**Effort:** ~1h
**Deps:** None

---

## The problem

`RipperConfig.load()` does a bare `as unknown` cast with no runtime validation:

```ts
const raw = JSON.parse(text) as unknown;
// ...
return raw as RipperConfigInterface;  // no shape check
```

A missing `output.basePath`, a string where a number is expected, or an extra typo key
all silently succeed at load time and produce confusing failures downstream
(e.g., `Cannot read properties of undefined` when HtmlScraper reads `config.targets`).

## Fix

Add AJV-based validation in `RipperConfig.load()`.
Follow the Torreya/Torus pattern: write the JSON Schema once, derive the TypeScript type
from it with `json-schema-to-ts`, compile the AJV validator once at module load.

### Schema location

`src/config/RipperConfigSchema.ts` — exports:
- `RIPPER_CONFIG_SCHEMA` (JSON Schema object, `as const`)
- `RipperConfigInterface` (derived via `FromSchema<typeof RIPPER_CONFIG_SCHEMA>`)
- `validateRipperConfig` (compiled AJV validator function)

### `RipperConfig.load()` after fix

```ts
static async load(configPath: string): Promise<RipperConfigInterface> {
  const abs  = resolve(configPath);
  const text = await readFile(abs, 'utf-8');
  const raw  = JSON.parse(text) as unknown;

  if (!validateRipperConfig(raw)) {
    throw new Error(
      `Invalid config at ${abs}:\n${ajv.errorsText(validateRipperConfig.errors)}`
    );
  }

  return raw;
}
```

## Dependencies to add

```json
"ajv":               "^8.17.0",
"json-schema-to-ts": "^3.1.1"
```

## Acceptance criteria

- [ ] `RipperConfigSchema.ts` exports schema, derived type, and validator
- [ ] `RipperConfigInterface` in `RipperConfig.ts` is imported from schema file, not re-declared
- [ ] `load()` throws on missing required field with message naming the field
- [ ] `load()` throws on wrong type with message naming the field and expected type
- [ ] `load()` succeeds with a valid minimal config: `{ "output": { "basePath": "./out" } }`
- [ ] `npm run typecheck` passes
- [ ] Unit test in Lane 03 `RipperConfig.test.ts` covers valid + two invalid cases
