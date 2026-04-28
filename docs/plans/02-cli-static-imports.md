# Lane 02 — CLI Static Imports

**Status:** Ready
**Effort:** ~30 min
**Deps:** None

---

## The problem

All three CLI command handlers use dynamic `await import(...)` inside their action callbacks:

```ts
// current (wrong):
.action(async (opts) => {
  const { RipperConfig }     = await import('../config/RipperConfig.js');
  const { MediaWikiScraper } = await import('../scrapers/MediaWikiScraper.js');
  ...
});
```

This violates the project standard: **static imports only**. Dynamic imports also mean
the module is not present in the compilation graph for dead-code analysis, and IDE
navigation breaks.

The original motivation was avoiding startup overhead, but Commander's `.action()` is
already lazy — the handler only runs when the subcommand is invoked. Static imports at
the top of `cli.ts` are safe.

## Fix

Move all `await import(...)` calls to static `import` statements at the top of `cli.ts`.
Remove all `await import` lines from action handlers. The `node:fs/promises` and `node:path`
imports are standard and should also be static.

## Acceptance criteria

- [ ] Zero `await import(` occurrences in `src/cli/cli.ts`
- [ ] All imports are static `import` declarations at top of file
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `ripperoni --help` outputs expected subcommand list (smoke test)
- [ ] `ripperoni scrape-wiki --help` outputs expected options
