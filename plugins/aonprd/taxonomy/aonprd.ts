// AONPRD Taxonomy.
//
// Declares the compiled concept tree for the aonprd plugin taxonomy.
// weapon-group, armor-group, article, condition, trait, action, hazard,
// weather-hazard).
//
// `loadAndCommonNode` now carries its inline contract directly
// (per λ "no wrapper helpers around class/module methods — fix the source
// method"). The `loadAndCommonTaxonomyNode` wrapper that previously layered
// the contract here has been removed.
import { loadAndCommonNode }   from '../nodes/loadAndCommon.js';
import { labelPairBlockNode }  from '../capabilities/labelPairBlock.js';
import { sectionWalkerNode }   from '../capabilities/sectionWalker.js';
import { sourceRefNode }       from '../capabilities/sourceRef.js';
import { metaTagsNode }        from '../capabilities/metaTags.js';
import { savingThrowNode }     from '../capabilities/savingThrow.js';
import { languageConcept }     from '../concepts/language.js';
import { planeConcept }        from '../concepts/plane.js';
import { contributorConcept }  from '../concepts/contributor.js';
import { weaponGroupConcept }  from '../concepts/weapon-group.js';
import { armorGroupConcept }   from '../concepts/armor-group.js';
import { articleConcept }      from '../concepts/article.js';
import { conditionConcept }    from '../concepts/condition/index.js';
import { traitConcept }        from '../concepts/trait/index.js';
import { actionConcept }       from '../concepts/action.js';
import { hazardConcept }       from '../concepts/hazard/index.js';
import { weatherHazardConcept } from '../concepts/weather-hazard.js';
// Batch B (items)
import { weaponConcept }      from '../concepts/weapon/index.js';
import { armorConcept }       from '../concepts/armor/index.js';
import { equipmentConcept }   from '../concepts/equipment/index.js';
import { relicConcept }       from '../concepts/relic.js';
import { setRelicConcept }    from '../concepts/set-relic.js';
import { siegeWeaponConcept } from '../concepts/siege-weapon.js';
import { vehicleConcept }     from '../concepts/vehicle.js';
import { familiarConcept }    from '../concepts/familiar/index.js';
// Batch C (creatures)
import { monsterConcept }         from '../concepts/monster/index.js';
import { animalCompanionConcept } from '../concepts/animal-companion/index.js';
import { monsterAbilityConcept }  from '../concepts/monster-ability.js';
import { monsterTemplateConcept } from '../concepts/monster-template.js';
import { monsterFamilyConcept }   from '../concepts/monster-family.js';
// Batch D (afflictions + misc)
import { curseConcept }   from '../concepts/curse.js';
import { diseaseConcept } from '../concepts/disease.js';
import { domainConcept }  from '../concepts/domain.js';
import { sourceConcept }  from '../concepts/source.js';
// Batch E (character / feat family)
import { ancestryConcept }         from '../concepts/ancestry.js';
import { backgroundConcept }       from '../concepts/background.js';
import { classConcept }            from '../concepts/class/index.js';
import { classSampleConcept }      from '../concepts/class-sample.js';
import { classKitConcept }         from '../concepts/class-kit.js';
import { npcThemeTemplateConcept } from '../concepts/npc-theme-template.js';
import { featConcept }             from '../concepts/feat.js';
import { skillConcept }            from '../concepts/skill/index.js';
import { archetypeConcept }        from '../concepts/archetype.js';
import { subclassFeatureConcept }  from '../concepts/subclass-feature/index.js';
// Batch F (spell / deity / rule)
import { spellConcept }         from '../concepts/spell/index.js';
import { ritualConcept }        from '../concepts/ritual/index.js';
import { deityConcept }         from '../concepts/deity/index.js';
import { deityCategoryConcept } from '../concepts/deity-category.js';
import { ruleConcept }          from '../concepts/rule.js';
// Batch G (kingmaker + generic)
import { kmStructureConcept }  from '../concepts/km-structure.js';
import { kmEventConcept }      from '../concepts/km-event.js';
import { tacticConcept }       from '../concepts/tactic.js';
import { campMealConcept }     from '../concepts/camp-meal.js';
import { campActivityConcept } from '../concepts/camp-activity.js';
import { kmWarTacticConcept }  from '../concepts/km-war-tactic.js';
import { kmWarArmyConcept }    from '../concepts/km-war-army.js';
import { genericConcept }      from '../concepts/generic/index.js';

import { Taxonomy }             from '../../../src/taxonomy/Taxonomy.js';
import { extractAonPath }       from '../common.js';
import type { ConceptDecl }     from '../../../src/taxonomy/Taxonomy.js';

// ─── Taxonomy declaration ─────────────────────────────────────────────────────

// ─── Interior concepts ────────────────────────────────────────────────────────
//
// `thing` registers the shared page-load capability. `entity` registers the
// generic label-pair / section-walker / source-ref capabilities that every
// entity-style page shares. Leaf concepts inherit from `entity` (entity pages
// with a `<span>` content host) or directly from `thing` (rule pages, generic
// fallback — structurally divergent pages that do not present a standard
// target span).
//
// `entity` is lifted out of `thing` to keep the three shared entity
// capabilities (`extract:label-pair-block`, `extract:section-walker`,
// `extract:source-ref`) off the rule chain. Their `hardRequired: ['aonprdTarget']`
// would otherwise short-circuit through the make-unknown terminal when
// `loadAndCommonNode` returns early for rule pages.
//
// Interior concepts have no output of their own — they exist to share
// capability chains downward. Declared with the default (`unknown`) TOutput.
const thingConcept: ConceptDecl = {
  id:     'thing',
  parent: null,
  capabilities: [
    loadAndCommonNode,
  ],
};

const entityConcept: ConceptDecl = {
  id:     'entity',
  parent: 'thing',
  capabilities: [
    labelPairBlockNode,
    sectionWalkerNode,
    sourceRefNode,
    // lifted from per-finalize inlined `extractMetaDescription` /
    // `extractMetaKeywords` calls. Every entity-style page benefits. Soft-fails
    // when `aonprdCheerio` is absent (rule pages, generic fallback).
    metaTagsNode,
    // Lifted from per-concept inlined parsers (curse, disease, spell/affliction,
    // ritual, weather-hazard). Soft-fails when `aonprdCommon` is absent or the
    // Saving Throw field is missing.
    savingThrowNode,
  ],
};

/**
 * AONPRD concept declaration tuple. Declared with `as const satisfies` so the
 * literal tuple type is preserved — `ConceptOutputUnion<typeof AONPRD_TAXONOMY>`
 * resolves to the union of every leaf concept's `*Output` type.
 *
 * Interior concepts (`thing`, `entity`) contribute their default `unknown`
 * `TOutput`, which is identity in the resulting union and therefore does not
 * widen the leaf output types.
 */
export const AONPRD_TAXONOMY = [
  thingConcept,
  entityConcept,
  languageConcept,
  planeConcept,
  contributorConcept,
  weaponGroupConcept,
  armorGroupConcept,
  articleConcept,
  conditionConcept,
  traitConcept,
  actionConcept,
  hazardConcept,
  weatherHazardConcept,
  // Batch B (items)
  weaponConcept,
  armorConcept,
  equipmentConcept,
  relicConcept,
  setRelicConcept,
  siegeWeaponConcept,
  vehicleConcept,
  familiarConcept,
  // Batch C (creatures)
  monsterConcept,
  animalCompanionConcept,
  monsterAbilityConcept,
  monsterTemplateConcept,
  monsterFamilyConcept,
  // Batch D (afflictions + misc)
  curseConcept,
  diseaseConcept,
  domainConcept,
  sourceConcept,
  // Batch E (character / feat family)
  ancestryConcept,
  backgroundConcept,
  classConcept,
  classSampleConcept,
  classKitConcept,
  npcThemeTemplateConcept,
  featConcept,
  skillConcept,
  archetypeConcept,
  subclassFeatureConcept,
  // Batch F (spell / deity / rule)
  spellConcept,
  ritualConcept,
  deityConcept,
  deityCategoryConcept,
  ruleConcept,
  // Batch G (kingmaker + generic)
  kmStructureConcept,
  kmEventConcept,
  tacticConcept,
  campMealConcept,
  campActivityConcept,
  kmWarTacticConcept,
  kmWarArmyConcept,
  genericConcept,
] as const satisfies readonly ConceptDecl<unknown>[];

/**
 * Compiled AONPRD taxonomy — pre-validated at module load time.
 * Provides `routeUrl`, `chainFor`, `allNodes`, and `annotations`.
 */
export const TAXONOMY = Taxonomy.compile(AONPRD_TAXONOMY, { namespace: 'aonprd', pathExtractor: extractAonPath });
