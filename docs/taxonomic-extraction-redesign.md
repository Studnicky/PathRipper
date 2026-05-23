# Taxonomic Extraction Architecture (Wave 6)

**Status:** Plan
**Author:** Wave 5 baseline → Wave 6 redesign
**Depends on:** `@noocodex/dagonizer ≥ 0.9.2` (co-located contracts + node-registry derive)

---

## Problem statement

Wave 5 delivered 50 typed extractors that produce 100% structured output across the AONPRD corpus (zero `raw_fields` orphans, zero `generic`-bucket records). The architecture, however, is **per-domain bespoke**:

- 50 type modules in `plugins/aonprd/*.ts`
- ~250 phase-node files under `plugins/aonprd/nodes/<type>/*.ts`
- A `TYPE_CHAINS` table in `parse.dag.ts` with one row per page-type
- A 90-line `switch` in `parse.task.ts:parseAonHtml`
- A 90-line `switch` in `nodes/detectType.ts`

Adding a new page-type to AON, or adding extraction for a new data source (bulbapedia, torreya, etc.), forces a copy-paste-rename of the entire pattern. None of the extraction logic is reusable across domains because the slice helpers are bound to domain shapes (`MonsterDefensesSlice`, `SpellCastSlice`, …).

## Goals

1. **Generic extraction primitives.** Capability nodes that operate on HTML structures, not domain concepts. Reusable across AONPRD, bulbapedia, torreya, and any future source.
2. **Configuration-driven taxonomy.** A page-type is declared as a taxonomic concept inheriting capabilities from its ancestors. Adding a new page-type = one row in the taxonomy file.
3. **Open-world composition.** Capability not relevant to a page emits `null`/`[]` and continues — no errors. The DAG branches by taxonomic position, not bespoke switch arms.
4. **Compile-time chainability checks.** TypeScript fails at `tsc` time if a taxonomy composition has a capability requiring data no upstream capability produces.
5. **Output equivalence with the Wave 5 baseline.** Every record in the corpus produces the same typed JSON (or a documented improvement). The Wave 5 per-type modules become the regression oracle.

## Non-goals

- Removing the per-type modules immediately. They become the **reference oracle**; the new architecture is validated against them before they're retired.
- Changing the `AonOutput` discriminated union surface beyond what's necessary. Downstream Squashage consumes the JSON; the JSON shape stays stable.
- Building extractors for non-AON sources in this wave. The architecture must accommodate them, but bulbapedia/torreya plug in via their own taxonomy file in a later wave.

## Dagonizer 0.9.x dependency surface

We rely on these `@noocodex/dagonizer` 0.9.x features:

| API | Why we need it |
|---|---|
| `NodeInterface.contract?: OperationContractFragment` | Capability nodes carry `hardRequired` / `produces` in-place. Single source of truth per capability. |
| `DAGDeriver.derive({ nodes })` | Taxonomic composer hands a `NodeInterface[]` directly to the deriver. No separate contracts table. |
| `ContractRegistryValidator` | Auto-validation: dangling reads throw `DAGError`; dead writes call `onContractWarning`. Catches taxonomy composition errors at registration time. |
| `Chainable<A, B>` | Compile-time type-level chainability check. Used by the taxonomy builder to assert capability-order safety. |
| `DAGBuilder.fromNodes({ name, version, entrypoint, nodes })` | Convenience for the most common case (linear chain). |
| `Dagonizer.onContractWarning(msg)` hook | Surface dead-write warnings during taxonomy authoring. |

## Architecture overview

```
                       ┌─────────────────────────────┐
                       │   taxonomy/aonprd.ts        │   declarative config
                       │   (concept tree + edges)    │
                       └──────────────┬──────────────┘
                                      │ Taxonomy.compile(...)
                                      ▼
   URL  →  aonprd:taxonomy-route  →  (1) per-leaf chain head
                                      │
                                      │ shared-prefix caps run
                                      ▼
                            aonprd:concept-dispatch       (2) re-route by aonprdConceptId
                                      │                       set in step 1
                                      ▼
                            concept-specific tail caps  →  finalize:<concept>  →  flow:terminate
                                      │
                                      ▼
                                state.output (typed JSON via setConceptOutput)
```

Two-phase routing:
1. **URL router** (`aonprd:taxonomy-route`) resolves the URL → concept id, stamps the concept's discriminator onto `state.output`, and dispatches to the first cap of that concept's chain.
2. **Concept-dispatch** nodes appear at every branch point in the leaf-chain trie. After the shared prefix runs, the dispatcher reads the stored `aonprdConceptId` and re-routes to the concept-specific tail. Subsequent branch points in the trie get their own dispatcher instances.

The DAG is constructed via `DAGDeriver.derive({ nodes: TAXONOMY.allNodes(), annotations: TAXONOMY.annotations() })`. Annotations encode the per-branch terminals.
```

### Layer 1 — Generic capability nodes

Each capability is a single `NodeInterface` with a co-located `OperationContractFragment`. They are **domain-agnostic**: they operate on HTML structures using cheerio, declare what state they read, and write what state they produce.

Inventory (extracted from Wave 5 slice helpers — see Migration table below):

```ts
// HTML-structure capabilities
'extract:label-pair-block'      // <b>Label</b> Value<br/> → field_map
'extract:section-walker'        // <h2>/<h3>...next heading → sections[]
'extract:hanging-indent-block'  // <span class="hanging-indent">… → blocks[]
'extract:bare-bold-block'       // <b>Name</b> prose<br/> → blocks[] (anchor-aware)
'extract:linked-anchor-list'    // comma-separated <a> list → refs[]
'extract:trait-list'            // <span class="trait"> spans → traits[]
'extract:source-ref'            // <b>Source</b> <a>Book pg. N</a> → SourceRef
'extract:action-cost-glyph'     // [one-action]/[reaction] glyph → ActionCost
'extract:cell-table'            // <table> grid → rows[]
'extract:variant-nav'           // Elite/Weak/PWL siblings on monster pages

// Semantic capabilities (operate on harvested structures)
'extract:identity'              // name, level, rarity, _type, url, IDs
'extract:saving-throw'          // DC + save + basic
'extract:affliction-stages'     // Stage N body + duration
'extract:statblock-defenses'    // AC, saves, HP, hardness, immunities, weaknesses, resistances
'extract:statblock-offense'     // speed, strikes, spell-lists
'extract:ability-scores'        // Str/Dex/Con/Int/Wis/Cha
'extract:spell-list'            // Tradition+Rank → {rank, spells[]}
'extract:outcomes-block'        // Critical Success / Success / Failure / Critical Failure
'extract:heightened'            // Heightened (Xth) → entries[]
'extract:granted-spells'        // subclass-style ranked spell grants
'extract:granted-features'      // Title-Case <h2>/<h3> sections → features[]
'extract:devotee-benefits'      // deity Divine Attribute/Font/Sanctification/Skill/Weapon/Domains
'extract:weather-effect-list'   // weather-hazard <h3>-headed effect blocks
'extract:meta-tags'             // <meta name="description"|"keywords">
'extract:flavor-text'           // hide-on-print lore span

// Finalization capability (one per terminal — single shared implementation)
'finalize:strip-claimed-keys'   // raw_fields = stripStructuredKeys(field_map, claimed)
```

Each capability declares a contract:

```ts
export const labelPairBlockNode: NodeInterface<ScrapeState, 'success' | 'error'> = {
  name: 'extract:label-pair-block',
  outputs: ['success', 'error'],
  contract: {
    hardRequired: ['aonprdCommon'],
    produces:     ['field_map'],
  } satisfies OperationContractFragment,
  async execute(state, _ctx) { /* … */ },
};
```

### Layer 2 — AON taxonomy

A single TypeScript file (`plugins/aonprd/taxonomy.ts`) declaring the concept tree.

```ts
// Sketch only — full schema in TaxonomyTypes.ts when the work starts.
interface ConceptDecl {
  /** Concept name — used as the type discriminator on output. */
  readonly id: string;
  /** Parent concept ID. Null only for the root. */
  readonly parent: string | null;
  /** URL paths that route directly to this concept (leaf concepts only). */
  readonly urlPaths?: readonly string[];
  /** Capability nodes added by this concept (inherited downward). */
  readonly capabilities: readonly NodeInterface<ScrapeState, string>[];
  /** Optional static fields layered onto state.output for this concept. */
  readonly discriminator?: Readonly<Record<string, unknown>>;
  /** Validation order: lower runs first within a phase. Defaults to 100. */
  readonly priority?: number;
}

export const AONPRD_TAXONOMY: readonly ConceptDecl[] = [
  { id: 'thing',
    parent: null,
    capabilities: [identityNode, sourceRefNode, traitListNode, sectionWalkerNode, metaTagsNode] },

  { id: 'item',
    parent: 'thing',
    capabilities: [labelPairBlockNode] },

    { id: 'weapon',
      parent: 'item',
      urlPaths: ['weapons'],
      capabilities: [/* weapon-mechanics capability with claimedLabels */] },

      { id: 'siege-weapon',
        parent: 'weapon',
        urlPaths: ['siegeweapons'],
        capabilities: [/* extra crew/ammunition/operator-actions capability */] },

    { id: 'relic',
      parent: 'item',
      urlPaths: ['relics'],
      capabilities: [relicGiftNode, relicAspectsNode, relicMilestonesNode] },

  { id: 'creature',
    parent: 'thing',
    capabilities: [statblockDefensesNode, statblockOffenseNode, abilityScoresNode,
                    hangingIndentBlockNode, bareBoldBlockNode] },

    { id: 'monster',
      parent: 'creature',
      urlPaths: ['monsters', 'creatures', 'npcs'],
      capabilities: [variantNavNode, flavorTextNode] },

    { id: 'animal-companion',
      parent: 'creature',
      urlPaths: ['companions'],
      capabilities: [companionAdvancementNode, supportBenefitNode] },

  { id: 'affliction',
    parent: 'thing',
    capabilities: [savingThrowNode, afflictionStagesNode,
                    labelPairBlockNode /* Onset, Maximum Duration */] },

    { id: 'curse',   parent: 'affliction', urlPaths: ['curses'] },
    { id: 'disease', parent: 'affliction', urlPaths: ['diseases'] },

  { id: 'spell',
    parent: 'thing',
    urlPaths: ['spells', 'mythicspells'],
    capabilities: [actionCostGlyphNode, labelPairBlockNode /* Cast, Range, … */,
                    outcomesBlockNode, heightenedNode] },

    { id: 'ritual',
      parent: 'spell',
      urlPaths: ['rituals', 'mythicrituals'],
      capabilities: [/* ritual-checks capability */] },

  { id: 'subclass-feature',
    parent: 'thing',
    urlPaths: [
      'bloodlines','mysteries','patrons','lessons','apparitions','causes',
      'eidolons','researchfields','hybridstudies','methodologies','muses',
      'ways','huntersedge','implements','consciousminds','subconsciousminds',
      'rackets','druidicorders','instincts','styles','arcaneschools',
      'arcanethesis','mythicdestinies','ikons','epithets','deviantfeats',
      'heritages','elements','followers','practices','hellknightorders',
      'doctrines','tenets','innovations',
    ],
    capabilities: [grantedSpellsNode, grantedFeaturesNode, labelPairBlockNode],
    /* discriminator: { subclass_family, parent_class } resolved at routing time
       from the URL path → fixed map. */ },

  /* … remaining concepts: feat, action, hazard, weather-hazard, plane,
     language, deity, deity-category, archetype, class, ancestry, background,
     condition, trait, source, article, vehicle, km-*, contributor,
     weapon-group, armor-group, etc. */
];
```

### Layer 3 — Dispatch + composer

`plugins/aonprd/parse.task.ts` collapses to a thin entry point:

```ts
import { Taxonomy } from './taxonomy.js';

const TAXONOMY = Taxonomy.compile(AONPRD_TAXONOMY);   // build closure, validate

export function parseAonHtml(html: string, url: string): AonOutput {
  const $ = loadHtml(html);
  const concept = TAXONOMY.routeUrl(url);             // URL → concept ID
  if (concept === null) return makeUnknown(url);

  const chain  = TAXONOMY.chainFor(concept);          // concept → NodeInterface[]
  const state  = ScrapeState.fromHtml(html, url, $);

  for (const node of chain) {
    const result = await node.execute(state, ctx);
    if (result.output === 'error') return makeUnknown(url);
  }
  return state.output as AonOutput;
}

export function register(dispatcher: RipperDagonizer<ScrapeState>): void {
  for (const node of TAXONOMY.allNodes()) dispatcher.registerNode(node);
  const dag = DAGDeriver.derive({
    name:       'aonprd:parse',
    version:    '3.0',
    entrypoint: TAXONOMY.entrypoint(),
    nodes:      TAXONOMY.allNodes(),
    annotations: TAXONOMY.annotations(),  // detect-type branches built from urlPaths
  });
  dispatcher.registerDAG(dag);
}
```

The 90-line `switch` and `TYPE_CHAINS` table both go away. The `detect-type` switch is generated from `urlPaths` on the taxonomy.

### Layer 4 — Validation

Three layers, all from dagonizer 0.9.x:

1. **Compile-time** — `Chainable<A, B>` asserts each capability pair in the composed chain is type-compatible. Drift fails at `tsc`. Composed via the `chain()` helper in `plugins/aonprd/taxonomy.ts` so concepts opt in pairwise.
2. **Registration-time** — `ContractRegistryValidator` (run automatically by `DAGDeriver.derive({ nodes })` and `Dagonizer.registerDAG`) catches dangling reads (throw) + dead writes (warn via `onContractWarning`). `RipperDagonizer.onContractWarning` is overridden to surface warnings to the project logger.
3. **Runtime — open-world.** A capability whose `hardRequired` metadata is missing emits `'success'` with no-op output. A capability that hits a real error (e.g. malformed HTML) emits `'error'`; both `'success'` and `'error'` route to the SAME downstream target — the chain proceeds. Downstream capabilities that depend on the absent produces handle absence themselves (typically by soft-failing). The only failure modes are:
   - **Unrecognised URL** — taxonomy router emits `'unknown'` and routes to `aonprd:make-unknown`.
   - **Chain completed without producing `_type`** — `parse.taxonomic.ts` checks `state.output._type` after the chain runs; if missing, returns `{ _type: 'unknown', url }` and emits a contract warning via the project logger. The DAG-dispatch path matches: capability errors route to the next cap, not to `make-unknown`.

#### Discriminator stamping (Wave 6 M1)

Every leaf `ConceptDecl` declares a `discriminator` (e.g. `{ _type: 'language' }`) constrained by `Readonly<Partial<TOutput>>`. `Taxonomy.compile` indexes the declarations into a discriminator map. The `aonprd:taxonomy-route` node stamps the resolved concept's discriminator onto `state.output` before any downstream capability runs; the direct-call entry point in `parse.taxonomic.ts` performs the same stamp after `Taxonomy.routeUrl`. Concept extract/finalize nodes therefore never need to derive `_type` from a URL or a slice helper — the field is structurally present from the moment the concept dispatches.

#### Finalize merge convention (Wave 6 H13)

Every finalize node writes its assembled output through `setConceptOutput(state, assembled satisfies XxxOutput)` (`plugins/aonprd/concepts/_helpers.ts`). The helper merges the assembled literal onto any prior `state.output` (preserving the discriminator stamp and any slice writes from earlier extract nodes). The 17 overwrite-style finalizes that previously did `state.output = { ...assembled }` would have silently dropped fields written by upstream extract nodes; the merge variant is now the single convention.

## Migration table

The 50 Wave 5 type modules → the capability inventory. Each row shows what code lives in the type module today and where it lands in the new architecture.

| Wave 5 slice helper | Layer 2 (capability) | Layer 1 (HTML primitive used) |
|---|---|---|
| `extractMonsterBase` (identity + sources + traits) | `extract:identity` + `extract:source-ref` + `extract:trait-list` | shared cheerio harvester |
| `extractMonsterDefenses` | `extract:statblock-defenses` | `extract:label-pair-block` |
| `extractMonsterOffense` (speed, strikes, spell-lists) | `extract:statblock-offense` | `extract:label-pair-block` + `extract:hanging-indent-block` |
| `extractMonsterAbilities` (top + def + off) | `extract:hanging-indent-block` + `extract:bare-bold-block` | cheerio DOM walk |
| `extractMonsterMeta` (variants, family-links) | `extract:variant-nav` + `extract:linked-anchor-list` | shared |
| `finalizeMonster` | `finalize:strip-claimed-keys` | n/a |
| `parseSavingThrow` | `extract:saving-throw` | shared |
| `parseStages` (affliction stages) | `extract:affliction-stages` | shared |
| `parseSpellList` (rank → spells) | `extract:spell-list` | `extract:label-pair-block` |
| `extractSpellCast` (cast/range/area/etc.) | `extract:label-pair-block` parameterised with cast labels | shared |
| `extractSpellOutcomes` | `extract:outcomes-block` | shared |
| `extractSpellHeightened` | `extract:heightened` | shared |
| `extractDeityDevoteeBenefits` | `extract:devotee-benefits` | `extract:label-pair-block` (Divine *) |
| `parseBareBoldAbilities` (anchor-aware DOM walker) | `extract:bare-bold-block` | cheerio |
| `harvestFields` | `extract:label-pair-block` | shared |
| `harvestSections` | `extract:section-walker` | shared |
| `parseStrikes` | folded into `extract:statblock-offense` | `extract:hanging-indent-block` |
| `extractWeaponMechanics` | parameterised `extract:label-pair-block` | shared |
| `extractRelicGift/Aspects/Milestones` | dedicated capabilities (rare shapes) | shared |
| `extractClassProgression` (level-by-level parser) | `extract:class-progression` (AON-specific) | dedicated |
| `extractFamiliarAbilities` | `extract:hanging-indent-block` + `extract:bare-bold-block` | shared |
| `extractSkillActions` (proficiency-tier interleave) | `extract:skill-actions` (AON-specific structural quirk) | dedicated |
| `parseFamilyLinks` | `extract:linked-anchor-list` | shared |
| `isFlavorBoldLabel` / `isVariantOverlayJunk` | strip-predicates on `finalize:strip-claimed-keys` | n/a |

(Full mapping documented during execution — this is the first pass.)

## Migration plan

### Phase 6.0 — Bump dagonizer (DONE in step 1)

- ✅ `@noocodex/dagonizer ≥ 0.9.2` in `vendor/`
- ✅ Baseline tests still pass (769 unit + 60 e2e)

### Phase 6.1 — Capability foundations

Build the 4-6 most-shared capabilities first, with their `OperationContractFragment` co-located. Each must pass its own unit test against a real fixture.

- `extract:label-pair-block` (consumes `aonprdCommon`, produces `field_map`)
- `extract:section-walker` (consumes `aonprdCheerio`, produces `sections`)
- `extract:hanging-indent-block` (consumes `aonprdCheerio` + scope, produces `hanging_indent_blocks`)
- `extract:bare-bold-block` (consumes `aonprdCheerio` + scope, produces `bare_bold_blocks`)
- `extract:source-ref` (produces `source` + `sources`)
- `finalize:strip-claimed-keys` (consumes `field_map`, produces `raw_fields`)

Acceptance: each capability's unit test extracts the same data from the same fixtures as the Wave 5 slice helper it replaces.

### Phase 6.2 — Taxonomy compiler

Build `plugins/aonprd/taxonomy.ts` infrastructure:

- `Taxonomy.compile(concepts)` — validate the tree (no cycles, no orphan nodes), compute capability closure per leaf
- `Taxonomy.routeUrl(url)` — URL → concept ID
- `Taxonomy.chainFor(concept)` — concept → `NodeInterface[]` ordered by inheritance depth then priority
- `Taxonomy.annotations()` — emit detect-type branches + chain terminals for `DAGDeriver.derive`
- `Taxonomy.allNodes()` — for dispatcher registration

Acceptance: passing the empty taxonomy compiles to a no-op DAG that routes everything to `aonprd:make-unknown`.

### Phase 6.3 — First leaf concept (proof of pattern)

Pick a small concept with rich shape and migrate it end-to-end: **language**.

- Declare `thing → language` in `taxonomy.ts`
- Wire the capabilities the language extractor uses
- Diff the output against the Wave 5 baseline on all 138 language fixtures — must be byte-identical (or improvement documented)
- Retire `plugins/aonprd/language.ts` and `plugins/aonprd/nodes/language/`

Acceptance: `language.test.ts` passes against the taxonomic chain; the Wave 5 module is deleted; tests still total 769.

### Phase 6.4 — Migrate all 50 typed concepts

Parallelisable across Sonnet agents (one per concept family — creature, item, affliction, spell, subclass-feature, etc.). For each:

1. Add the concept row to `taxonomy.ts`
2. Confirm the capabilities used are already in the inventory; lift any new ones into Layer 1
3. Run the per-type fixture set; output must match Wave 5
4. Retire the Wave 5 module

Acceptance: per-type modules are gone; `parse.task.ts` is ~50 lines; `parse.dag.ts` is ~40 lines; the audit still reports zero orphans.

### Phase 6.5 — Cross-source validation

Set up a minimal `plugins/bulbapedia/taxonomy.ts` (or torreya) reusing the AON capabilities. Goal: prove generic capabilities work on a second domain. Doesn't have to be feature-complete — one concept with one capability is enough to validate the architecture.

Acceptance: a non-AON page parses through generic capabilities with no AON-specific code in the path.

### Phase 6.6 — Squashage downstream verification

The taxonomy concept names become the natural classification source of truth for Squashage. Confirm Squashage's classifier cascade still works on the new output format. If we expose the taxonomy concept hierarchy (parent edges) in the output JSON, Squashage's `TaxonomicNarrowingClassifierNode` gets a free ontology to narrow against.

## Acceptance criteria for Wave 6 complete

1. ✅ Zero per-type modules in `plugins/aonprd/` other than `taxonomy.ts`, capability files, and shared utilities.
2. ✅ `parse.task.ts` and `parse.dag.ts` together total < 200 LOC.
3. ✅ Output byte-equivalence with Wave 5 across all 13.5k fixtures (or every diff explicitly justified).
4. ✅ `npm run check` + `npm run test:e2e` green.
5. ✅ `audit-extraction-gaps.mjs` reports zero orphans (unchanged from Wave 5).
6. ✅ At least one non-AON taxonomy declared, demonstrating generic capability reuse.
7. ✅ `ContractRegistryValidator` reports no warnings during registration.

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Taxonomy can't express AON's irregular pages (subclass-feature variants, monster Elite overlays) | Each concept can carry AON-specific capabilities. The taxonomy permits leaf-only quirks; the inheritance only enforces a *minimum* capability set. |
| Output diff against Wave 5 baseline drifts in non-obvious ways | Per-fixture byte-diff harness run on every concept migration. Wave 5 modules stay in tree until their concept is signed off. |
| `Chainable<A, B>` compile-time check is too strict and rejects valid compositions | Fall back to runtime `ContractRegistryValidator` only for that chain; document the gap. |
| Performance regression (capability composition has more node-call overhead than monolithic extractors) | Measure with the 13.5k corpus before and after; cheerio parse is the dominant cost, not node dispatch. Expected delta < 5%. |
| Bulbapedia/torreya source HTML shapes diverge enough that "generic capabilities" turn out to be AON-shaped | Phase 6.5 explicitly catches this. If it fails, the capability set splits into `extract:aonprd:*` and `extract:generic:*` namespaces; we lose some sharing but retain the taxonomy structure. |

## Open questions

1. **Where do per-fixture diffs live during migration?** Suggest `tests/regression/aonprd/<concept>.diff.json` — gitignored if too noisy; reviewed during the migration PR for each concept.
2. **Squashage taxonomy IRI naming.** Should the AON taxonomy export a `taxonomy.ttl` or `taxonomy.jsonld` for Squashage to consume directly? Defer to Phase 6.6.
3. **Per-concept output schema.** Currently each Wave 5 module defines its own `*Output` interface. With taxonomic inheritance, the natural shape is "concept = TS interface; subconcept extends parent interface." We can either auto-derive these from capability `produces` lists, or hand-author them as today. Recommend hand-authoring for now; revisit later.

## What this document is not

- A code change. Nothing here is committed; this is the plan that gates Phase 6.1.
- A schedule. Each phase has its own acceptance criteria; the team paces them.
- A blanket replacement of Wave 5. Wave 5 stays in tree as the oracle until Phase 6.4 retires each module concept-by-concept.
