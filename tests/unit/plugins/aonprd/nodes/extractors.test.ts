// Unit tests for all per-type extractor nodes.
// Tests the complete chain: loadAndCommon → extractXxx outputs the expected typed record.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }      from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { extractSpellNode }       from '../../../../../plugins/aonprd/nodes/extractSpell.js';
import { extractMonsterNode }     from '../../../../../plugins/aonprd/nodes/extractMonster.js';
import { extractFeatNode }        from '../../../../../plugins/aonprd/nodes/extractFeat.js';
import { extractWeaponNode }      from '../../../../../plugins/aonprd/nodes/extractWeapon.js';
import { extractEquipmentNode }   from '../../../../../plugins/aonprd/nodes/extractEquipment.js';
import { extractConditionNode }   from '../../../../../plugins/aonprd/nodes/extractCondition.js';
import { extractBackgroundNode }  from '../../../../../plugins/aonprd/nodes/extractBackground.js';
import { extractGenericNode }     from '../../../../../plugins/aonprd/nodes/extractGeneric.js';
import { unknownTerminalNode }    from '../../../../../plugins/aonprd/nodes/unknownTerminal.js';
import { loadFixture, makeState, stubContext } from './helpers.js';

// Helper: load fixture + run loadAndCommon so metadata is stashed.
async function prime(fixtureName: string, url: string) {
  const html  = await loadFixture(fixtureName);
  const state = makeState(html, url);
  const r     = await loadAndCommonNode.execute(state, stubContext);
  assert.equal(r.output, 'success', `loadAndCommon failed for ${fixtureName}`);
  return state;
}

describe('aonprd extractor nodes — spell', () => {
  it('outputs success and writes spell record', async () => {
    const state = await prime('spell-abyssal-plague.html', 'https://2e.aonprd.com/Spells.aspx?ID=1');
    const r = await extractSpellNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
    assert.ok(state.output !== null, 'output should be set');
    assert.equal(state.output?.['_type'], 'spell');
    assert.equal(state.output?.['name'], 'Abyssal Plague');
  });

  it('outputs error when metadata is missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Spells.aspx?ID=1');
    // No loadAndCommon called — metadata absent.
    const r = await extractSpellNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('aonprd extractor nodes — monster', () => {
  it('outputs success and writes monster record', async () => {
    const state = await prime('monster-phantasmal-minion.html', 'https://2e.aonprd.com/Monsters.aspx?ID=1');
    const r = await extractMonsterNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
    assert.equal(state.output?.['_type'], 'monster');
    assert.equal(state.output?.['name'], 'Phantasmal Minion');
  });
});

describe('aonprd extractor nodes — feat', () => {
  it('outputs success and writes feat record', async () => {
    const state = await prime('feat-dwarven-lore.html', 'https://2e.aonprd.com/Feats.aspx?ID=1');
    const r = await extractFeatNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
    assert.equal(state.output?.['_type'], 'feat');
    assert.equal(state.output?.['name'], 'Dwarven Lore');
  });
});

describe('aonprd extractor nodes — weapon', () => {
  it('outputs success and writes weapon record', async () => {
    const state = await prime('weapon-longsword.html', 'https://2e.aonprd.com/Weapons.aspx?ID=300');
    const r = await extractWeaponNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
    assert.equal(state.output?.['_type'], 'weapon');
  });
});

describe('aonprd extractor nodes — equipment', () => {
  it("outputs success and writes equipment record for Adventurer's Pack", async () => {
    const state = await prime('equipment-adventurers-pack.html', 'https://2e.aonprd.com/Equipment.aspx?ID=1');
    const r = await extractEquipmentNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
    assert.equal(state.output?.['_type'], 'equipment');
  });
});

describe('aonprd extractor nodes — condition', () => {
  it('outputs success and writes condition record', async () => {
    const state = await prime('condition-blinded.html', 'https://2e.aonprd.com/Conditions.aspx?ID=1');
    const r = await extractConditionNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
    assert.equal(state.output?.['_type'], 'condition');
    assert.equal(state.output?.['name'], 'Blinded');
  });
});

describe('aonprd extractor nodes — background', () => {
  it('outputs success and writes background record', async () => {
    const state = await prime('background-acolyte.html', 'https://2e.aonprd.com/Backgrounds.aspx?ID=1');
    const r = await extractBackgroundNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
    assert.equal(state.output?.['_type'], 'background');
    assert.equal(state.output?.['name'], 'Acolyte');
  });
});

describe('aonprd extractor nodes — generic', () => {
  it('falls back to generic when URL has unmapped path', async () => {
    const html  = await loadFixture('spell-abyssal-plague.html');
    const state = makeState(html, 'https://2e.aonprd.com/Languages.aspx?ID=1');
    await loadAndCommonNode.execute(state, stubContext);
    const r = await extractGenericNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
    assert.equal(state.output?.['_type'], 'generic');
    assert.equal(state.output?.['name'], 'Abyssal Plague');
  });
});

describe('aonprd:make-unknown node', () => {
  it('writes unknown record to state.output and outputs success', async () => {
    const state = makeState('', 'https://2e.aonprd.com/X.aspx?ID=99');
    state.page = { targetId: 'aonprd', title: '', url: 'https://2e.aonprd.com/X.aspx?ID=99' };
    const r = await unknownTerminalNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
    assert.ok(state.output !== null, 'output should be set');
    assert.equal(state.output?.['_type'], 'unknown');
    assert.equal(state.output?.['url'], 'https://2e.aonprd.com/X.aspx?ID=99');
  });
});
