# Lane 03 — Test Suite

**Status:** Blocked by Lanes 01 and 02
**Effort:** ~4h
**Deps:** Lanes 01, 02 (test correct code, not the broken version)

Runner: `node --test` (native Node.js test runner, no vitest, no jest).
Test files: `tests/unit/**/*.test.ts`, run via `tsx` for TypeScript support.
Pattern: behavior-focused assertions, no mocks of internal dependencies —
only mock network and filesystem boundaries.

---

## Unit tests required

### `tests/unit/modules/http/ErrorClassifier.test.ts`

- All 7 categories triggered by correct error shapes
- NETWORK: `code: 'ECONNREFUSED'`, `code: 'ENOTFOUND'`
- TIMEOUT: `code: 'ETIMEDOUT'`
- THROTTLED: `status: 429` — verify `backoffHint` is populated
- THROTTLED: `status: 429` with `Retry-After: 30` header → `backoffHint` = 30000
- TRANSIENT: `status: 503`, `status: 500`
- PERMANENT: `status: 404`, `status: 400`
- VALIDATION: `name: 'TypeError'`, `name: 'SyntaxError'`
- RESOURCE: `code: 'ENOMEM'`
- UNKNOWN: error with no matching fields → `retryable: false`
- `isRetryable()`: true for NETWORK/THROTTLED/TIMEOUT/TRANSIENT, false for others

### `tests/unit/modules/http/RetryExecutor.test.ts`

- Successful fn on first attempt returns result, no delay
- Retryable error on attempt 1, success on attempt 2 → returns result
- Three retryable failures → throws on attempt 3 (maxAttempts: 3)
- Non-retryable error (PERMANENT) → throws immediately without retrying
- Backoff hint from THROTTLED error → delay ≥ backoffHint (use fake timers)
- Custom `maxAttempts: 1` → single attempt, no retry

### `tests/unit/modules/http/RateLimiter.test.ts`

- `perSecond(10)` → `minTimeMs` = 100
- `withDelay(500)` → sequential calls are ≥500ms apart
- `schedule()` returns the resolved value of the scheduled fn

### `tests/unit/pipeline/Pipeline.test.ts`

- Empty pipeline `execute()` → returns state unchanged
- Single task that calls `next()` → executes and returns
- Two tasks in sequence → both execute in order
- Task that does NOT call `next()` → subsequent tasks do NOT run
- Task that throws → error propagates out of `execute()`
- `addTasks([...])` convenience method adds all tasks

### `tests/unit/crawlers/LinkLister.test.ts`

- Constructor: `target` and `delimiter` are separate (regression for Lane 01 fix)
- Link extraction: provide mock HTML, verify links matching `target` are returned
- Deduplication: same URL appearing in multiple pages returned once
- Domain filter: links outside `domain` regex not returned

To avoid real network calls: override `fetch` in test scope with a stub that returns
controlled HTML fixtures.

### `tests/unit/scrapers/WikitextParser.test.ts`

- `parse()` with infobox wikitext → `infobox` fields populated
- `parse()` with section wikitext → `sections` title and wikitext populated
- `parse()` with categories → `categories` array populated
- `infoboxField(parsed, key)` → returns string or null
- `infoboxNumber(parsed, key)` → returns number or null for numeric fields
- `infoboxNumber(parsed, key)` → returns null for non-numeric string fields

### `tests/unit/config/RipperConfig.test.ts`

- `load()` with valid JSON → returns typed config
- `load()` with missing file → throws with clear path in message
- `load()` with non-object JSON → throws with clear message
- `defaults()` → returns object with `output.basePath`

---

## Test script updates

Update `package.json` `test` script to use `tsx` for TypeScript files:

```json
"test":       "node --test --require tsx/cjs 'tests/**/*.test.ts'",
"test:unit":  "node --test --require tsx/cjs 'tests/unit/**/*.test.ts'"
```

Add `tsx` to devDependencies.

---

## Acceptance criteria

- [ ] All unit test files exist and pass
- [ ] `npm run test:unit` exits 0
- [ ] `npm run check` (typecheck + lint + test) exits 0
- [ ] Each test file has ≥1 assertion for the happy path and ≥1 for a failure/edge case
- [ ] No test uses `jest`, `vitest`, or any mock framework — native `assert` only
- [ ] No test makes real network requests
