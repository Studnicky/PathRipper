# Lane 07 — Target Neutrality

**Status:** Ready
**Effort:** ~45 min
**Deps:** None (touches docs + README + example config)

---

## The problem

Target-specific names are baked into source, docs, README, and Lane 06's example
config. Ripperoni is a general-purpose configurable scraper — no real target should
appear anywhere except in the user's own `ripperoni.config.json`.

Specific occurrences (`grep -rn -i "bulbapedia\|aonprd\|serebii\|piazo\|pathfinder\|pok[ée]mon\|charmander\|bulbasaur"`):

- `README.md:28,65,66,85` — quickstart + config example use `bulbapedia`
- `docs/index.html:114-115,121-122,130-131,134,138-139,146-147,182,195,200` — same
- `docs/architecture.html:179` — "Bulbapedia policy"
- `docs/roadmap.html:115,142,147` — Bulbapedia / Pokémon games / pkNX references
- `docs/plans/05-mediawiki-batch.md:68-70` — acceptance criteria mention Bulbapedia / Bulbasaur / Charmander
- `docs/plans/06-example-config-cleanup.md:25-52` — example uses bulbapedia/serebii/aonprd
- `src/cli/cli.ts:21,51` — default config path is `./ripper.config.json`,
  but README/docs reference `./ripperoni.config.json` (drift, fix while neutralizing)

## Fix

Replace all real target names with neutral placeholders. Standard placeholders:

| Domain placeholder           | Use for                          |
|------------------------------|----------------------------------|
| `https://wiki.example`       | MediaWiki API host               |
| `https://example.com`        | Generic HTML target              |
| `<your-target>` (literal)    | Target ID in CLI examples        |
| `you@example.com`            | User-Agent contact               |
| `example-category`           | Wiki category name               |
| `MyApp/1.0`                  | User-Agent product token         |

### Files to change

1. **`README.md`** — quickstart, config block, programmatic example
2. **`docs/index.html`** — config block, CLI examples, programmatic example, opening blurb
3. **`docs/architecture.html`** — drop the "Bulbapedia policy" line; speak generically about wiki rate limits
4. **`docs/roadmap.html`** — companion tools section removed.
5. **`docs/plans/05-mediawiki-batch.md`** — change acceptance criteria to use `wiki.example` / generic page title pair / generic category
6. **`docs/plans/06-example-config-cleanup.md`** — replaced by Lane 06 update below
7. **`src/cli/cli.ts:21,51`** — align default config path to `./ripperoni.config.json` (matches README + bin name)

### Rule going forward

> No real target name in source, docs, schemas, examples, fixtures, or CHANGELOG.
> If a name slips in, treat it the same as a hardcoded credential — fix at the source.

A pre-push grep gate covers this in Lane 10 (`scripts/check-neutrality.sh`).

## Acceptance criteria

- [ ] `grep -rni 'bulbapedia\|aonprd\|serebii\|piazo\|pathfinder\|pok[ée]mon\|charmander\|bulbasaur' src/ docs/ README.md` returns zero matches
- [ ] CLI default config path is `./ripperoni.config.json` in both `scrape-html` and `scrape-wiki` (matches README and bin name)
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] All documentation examples use only `example.com` / `wiki.example` / `<your-target>` placeholders
