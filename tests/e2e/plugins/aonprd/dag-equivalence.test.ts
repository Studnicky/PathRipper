// DAG-vs-direct equivalence — Wave 1 (Wave 6 audit B2).
//
// Permanent regression oracle: each fixture is dispatched through the
// registered `aonprdParseDAG` against a real `RipperDagonizer`, and the
// resulting `state.output` is deep-compared against the direct-call output
// from `parseAonHtml(html, url)`. Any divergence proves the production DAG
// path and the direct-call path have drifted — the exact gap that hid the
// Wave 6 B1 rule-page regression.
//
// The rule fixture is the named oracle for the B1 fix: the entity-prefix
// capabilities must soft-fail on rule pages so the DAG produces `_type: 'rule'`
// instead of `_type: 'unknown'`.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Dagonizer } from '@noocodex/dagonizer';

import { ScrapeState }       from '../../../../src/state/ScrapeState.js';
import { TerminalNode }      from '../../../../src/nodes/TerminalNode.js';
import { TAXONOMY }          from '../../../../plugins/aonprd/taxonomy/aonprd.js';
import { aonprdParseDAG }    from '../../../../plugins/aonprd/parse.dag.js';
import { parseAonHtml }      from '../../../../plugins/aonprd/parse.task.js';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR  = resolve(__dirname, '../fixtures/aonprd');

async function loadFixture(name: string): Promise<string> {
  return readFile(resolve(FIXTURE_DIR, name), 'utf-8');
}

function buildDispatcher(): Dagonizer<ScrapeState, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dispatcher = new Dagonizer<ScrapeState, any>({ services: {} as any });
  dispatcher.registerNode(TerminalNode);
  for (const node of TAXONOMY.allNodes()) {
    dispatcher.registerNode(node);
  }
  dispatcher.registerDAG(aonprdParseDAG);
  return dispatcher;
}

async function runViaDAG(html: string, url: string): Promise<Record<string, unknown>> {
  const dispatcher = buildDispatcher();
  const state = new ScrapeState();
  state.page = { targetId: 'aonprd', title: '', url, html };
  await dispatcher.execute('aonprd:parse', state);
  return state.output ?? { url };
}

interface FixtureCase {
  /** Human-readable family label (used in test name). */
  readonly family:  string;
  /** Fixture HTML filename under tests/e2e/plugins/fixtures/aonprd/. */
  readonly fixture: string;
  /** Canonical URL associated with the fixture. */
  readonly url:     string;
  /** Expected output `_type` (sanity check before deep-equal). */
  readonly type:    string;
}

// One fixture per concept family that has a committed HTML fixture. The rule
// fixture is the B1 regression oracle and is asserted explicitly below.
const CASES: readonly FixtureCase[] = [
  { family: 'action',            fixture: 'action-hunt-prey.html',                       url: 'https://2e.aonprd.com/Actions.aspx?ID=1',           type: 'action' },
  { family: 'ancestry',          fixture: 'ancestry-goblin.html',                        url: 'https://2e.aonprd.com/Ancestries.aspx?ID=1',        type: 'ancestry' },
  { family: 'animal-companion',  fixture: 'animal-companion-cave-pterosaur.html',        url: 'https://2e.aonprd.com/Companions.aspx?ID=1',        type: 'animal-companion' },
  { family: 'archetype',         fixture: 'archetype-geomancer.html',                    url: 'https://2e.aonprd.com/Archetypes.aspx?ID=1',        type: 'archetype' },
  { family: 'armor',             fixture: 'armor-leather.html',                          url: 'https://2e.aonprd.com/Armor.aspx?ID=1',             type: 'armor' },
  { family: 'armor-group',       fixture: 'armor-group-chain.html',                      url: 'https://2e.aonprd.com/ArmorGroups.aspx?ID=1',       type: 'armor-group' },
  { family: 'article',           fixture: 'article-walkena.html',                        url: 'https://2e.aonprd.com/Articles.aspx?ID=1',          type: 'article' },
  { family: 'background',        fixture: 'background-acolyte.html',                     url: 'https://2e.aonprd.com/Backgrounds.aspx?ID=1',       type: 'background' },
  { family: 'camp-activity',     fixture: 'camp-activity-camouflage-campsite.html',      url: 'https://2e.aonprd.com/CampActivities.aspx?ID=1',    type: 'camp-activity' },
  { family: 'camp-meal',         fixture: 'camp-meal-baked-spider-legs.html',            url: 'https://2e.aonprd.com/CampMeals.aspx?ID=1',         type: 'camp-meal' },
  { family: 'class',             fixture: 'class-sorcerer.html',                         url: 'https://2e.aonprd.com/Classes.aspx?ID=1',           type: 'class' },
  { family: 'class-kit',         fixture: 'class-kit-alchemist.html',                    url: 'https://2e.aonprd.com/ClassKits.aspx?ID=1',         type: 'class-kit' },
  { family: 'class-sample',      fixture: 'class-sample-chirurgeon.html',                url: 'https://2e.aonprd.com/ClassSamples.aspx?ID=1',      type: 'class-sample' },
  { family: 'condition',         fixture: 'condition-blinded.html',                      url: 'https://2e.aonprd.com/Conditions.aspx?ID=1',        type: 'condition' },
  { family: 'contributor',       fixture: 'contributor-devin.html',                      url: 'https://2e.aonprd.com/Contributors.aspx?ID=1',      type: 'contributor' },
  { family: 'curse',             fixture: 'curse-mummy-rot.html',                        url: 'https://2e.aonprd.com/Curses.aspx?ID=1',            type: 'curse' },
  { family: 'deity',             fixture: 'deity-abadar.html',                           url: 'https://2e.aonprd.com/Deities.aspx?ID=1',           type: 'deity' },
  { family: 'deity-category',    fixture: 'deity-category-empyreal-lords.html',          url: 'https://2e.aonprd.com/DeityCategories.aspx?ID=1',   type: 'deity-category' },
  { family: 'disease',           fixture: 'disease-bubonic-plague.html',                 url: 'https://2e.aonprd.com/Diseases.aspx?ID=1',          type: 'disease' },
  { family: 'domain',            fixture: 'domain-air.html',                             url: 'https://2e.aonprd.com/Domains.aspx?ID=1',           type: 'domain' },
  { family: 'equipment',         fixture: 'equipment-adventurers-pack.html',             url: 'https://2e.aonprd.com/Equipment.aspx?ID=1',         type: 'equipment' },
  { family: 'familiar',          fixture: 'familiar-ceru.html',                          url: 'https://2e.aonprd.com/Familiars.aspx?ID=1',         type: 'familiar' },
  { family: 'feat',              fixture: 'feat-dwarven-lore.html',                      url: 'https://2e.aonprd.com/Feats.aspx?ID=1',             type: 'feat' },
  { family: 'hazard',            fixture: 'hazard-haunted-bridge.html',                  url: 'https://2e.aonprd.com/Hazards.aspx?ID=1',           type: 'hazard' },
  { family: 'km-event',          fixture: 'km-event-archaeological-find.html',           url: 'https://2e.aonprd.com/KMEvents.aspx?ID=1',          type: 'km-event' },
  { family: 'km-structure',      fixture: 'km-structure-academy.html',                   url: 'https://2e.aonprd.com/KMStructures.aspx?ID=1',      type: 'km-structure' },
  { family: 'km-war-army',       fixture: 'km-war-army-greengripe-bombardiers.html',     url: 'https://2e.aonprd.com/KMWarArmies.aspx?ID=1',       type: 'km-war-army' },
  { family: 'km-war-tactic',     fixture: 'km-war-tactic-ambush.html',                   url: 'https://2e.aonprd.com/KMWarTactics.aspx?ID=1',      type: 'km-war-tactic' },
  { family: 'language',          fixture: 'language-common.html',                        url: 'https://2e.aonprd.com/Languages.aspx?ID=1',         type: 'language' },
  { family: 'monster',           fixture: 'monster-phantasmal-minion.html',              url: 'https://2e.aonprd.com/Monsters.aspx?ID=1',          type: 'monster' },
  { family: 'monster-ability',   fixture: 'monster-ability-grab.html',                   url: 'https://2e.aonprd.com/MonsterAbilities.aspx?ID=1',  type: 'monster-ability' },
  { family: 'monster-family',    fixture: 'monster-family-elemental-metal.html',         url: 'https://2e.aonprd.com/MonsterFamilies.aspx?ID=1',   type: 'monster-family' },
  { family: 'monster-template',  fixture: 'monster-template-elite.html',                 url: 'https://2e.aonprd.com/MonsterTemplates.aspx?ID=1',  type: 'monster-template' },
  { family: 'npc-theme-template',fixture: 'npc-theme-template-firebrands.html',          url: 'https://2e.aonprd.com/NPCThemeTemplates.aspx?ID=1', type: 'npc-theme-template' },
  { family: 'plane',             fixture: 'plane-earth.html',                            url: 'https://2e.aonprd.com/Planes.aspx?ID=1',            type: 'plane' },
  { family: 'relic',             fixture: 'relic-righteous-call.html',                   url: 'https://2e.aonprd.com/Relics.aspx?ID=1',            type: 'relic' },
  // Ritual concept emits `_type: 'spell'` with `kind: 'ritual'` — rituals
  // share the spell HTML structure and output shape.
  { family: 'ritual',            fixture: 'ritual-awaken-animal.html',                   url: 'https://2e.aonprd.com/Rituals.aspx?ID=1',           type: 'spell' },
  { family: 'set-relic',         fixture: 'set-relic-duelists-blazon.html',              url: 'https://2e.aonprd.com/SetRelics.aspx?ID=1',         type: 'set-relic' },
  { family: 'siege-weapon',      fixture: 'siege-weapon-volley-gun.html',                url: 'https://2e.aonprd.com/SiegeWeapons.aspx?ID=1',      type: 'siege-weapon' },
  { family: 'skill',             fixture: 'skill-acrobatics.html',                       url: 'https://2e.aonprd.com/Skills.aspx?ID=1',            type: 'skill' },
  { family: 'source',            fixture: 'source-core-rulebook.html',                   url: 'https://2e.aonprd.com/Sources.aspx?ID=1',           type: 'source' },
  { family: 'spell',             fixture: 'spell-abyssal-plague.html',                   url: 'https://2e.aonprd.com/Spells.aspx?ID=1',            type: 'spell' },
  { family: 'subclass-feature',  fixture: 'subclass-feature-bloodline-aberrant.html',    url: 'https://2e.aonprd.com/Bloodlines.aspx?ID=1',        type: 'subclass-feature' },
  { family: 'tactic',            fixture: 'tactic-mirrored-wall.html',                   url: 'https://2e.aonprd.com/Tactics.aspx?ID=1',           type: 'tactic' },
  { family: 'trait',             fixture: 'trait-magical.html',                          url: 'https://2e.aonprd.com/Traits.aspx?ID=1',            type: 'trait' },
  { family: 'vehicle',           fixture: 'vehicle-airship.html',                        url: 'https://2e.aonprd.com/Vehicles.aspx?ID=1',          type: 'vehicle' },
  { family: 'weapon',            fixture: 'weapon-longsword.html',                       url: 'https://2e.aonprd.com/Weapons.aspx?ID=300',         type: 'weapon' },
  { family: 'weapon-group',      fixture: 'weapon-group-club.html',                      url: 'https://2e.aonprd.com/WeaponGroups.aspx?ID=1',      type: 'weapon-group' },
  { family: 'weather-hazard',    fixture: 'weather-hazard-blizzard.html',                url: 'https://2e.aonprd.com/WeatherHazards.aspx?ID=1',    type: 'weather-hazard' },
];

describe('aonprdParseDAG vs parseAonHtml — equivalence', () => {
  // ── Rule fixture (B1 regression oracle) ─────────────────────────────────────
  // The rule page exercises the soft-fail open-world contract for the entity
  // capabilities (label-pair / section-walker / source-ref). Before Wave 1
  // those capabilities returned `'error'` when `aonprdTarget` was missing —
  // routing the rule page to `aonprd:make-unknown` through the DAG path. This
  // test asserts the DAG path produces `_type: 'rule'` and matches direct-call.
  it('B1 regression oracle — rule page routes through DAG to _type=rule', async () => {
    const html = await loadFixture('rule-alchemy-unleashed.html');
    const url  = 'https://2e.aonprd.com/Rules.aspx?ID=100';
    const direct = await parseAonHtml(html, url);
    const dag    = await runViaDAG(html, url);
    assert.deepEqual(dag, direct, 'DAG output must match direct-call output');
  });

  for (const c of CASES) {
    it(`produces identical output via DAG dispatch vs direct call — ${c.family}`, async () => {
      const html = await loadFixture(c.fixture);
      const direct = await parseAonHtml(html, c.url);
      const dag    = await runViaDAG(html, c.url);
      assert.deepEqual(dag, direct, `DAG output diverged from direct-call for ${c.family}`);
    });
  }
});
