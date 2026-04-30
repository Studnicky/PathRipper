# Lane 01 — LinkLister Constructor Bug

**Status:** Ready
**Effort:** ~15 min
**Deps:** None

---

## The bug

`src/crawlers/LinkLister.ts` constructor assigns `config.delimiter` to `this.#target`
before correcting it two lines later via a `void` suppression hack:

```ts
// current (wrong):
this.#target   = config.delimiter;  // line 48 — assigns wrong value
this.#delimiter = config.delimiter;  // line 49
void config.target;                  // line 54 — suppression lint hack
this.#target = config.target;        // line 55 — corrects it

// correct:
this.#domain    = config.domain;
this.#target    = config.target;
this.#delimiter = config.delimiter;
```

The final runtime behavior is correct (line 55 wins), but the code is wrong
and the `void` suppression signals something is broken.

## Fix

Remove lines 48 and 54. Reorder the three field assignments to match declaration order.

## Acceptance criteria

- [ ] `this.#target`, `this.#domain`, `this.#delimiter` each assigned exactly once
- [ ] No `void config.*` anywhere in the constructor
- [ ] `npm run typecheck` still passes
- [ ] `npm run lint` still passes
- [ ] Unit test added: `new LinkLister({ domain, target, delimiter })` — verify `buildList`
      returns only URLs matching `target`, not those matching only `delimiter`
