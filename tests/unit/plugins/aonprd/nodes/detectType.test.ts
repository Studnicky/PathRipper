// Unit tests for aonprd:detect-type node.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { detectTypeNode } from '../../../../../plugins/aonprd/nodes/detectType.js';
import { makeState, stubContext } from './helpers.js';

// Helper: build state with just a URL set (no HTML needed for detectType).
function urlState(url: string) {
  const state = makeState('', url);
  state.page = { targetId: 'aonprd', title: '', url };
  return state;
}

describe('aonprd:detect-type node', () => {
  it('routes Spells.aspx to spell', async () => {
    const r = await detectTypeNode.execute(urlState('https://2e.aonprd.com/Spells.aspx?ID=1'), stubContext);
    assert.equal(r.output, 'spell');
  });

  it('routes Rituals.aspx to spell (ritual sub-type)', async () => {
    const r = await detectTypeNode.execute(urlState('https://2e.aonprd.com/Rituals.aspx?ID=1'), stubContext);
    assert.equal(r.output, 'spell');
  });

  it('routes Monsters.aspx to monster', async () => {
    const r = await detectTypeNode.execute(urlState('https://2e.aonprd.com/Monsters.aspx?ID=1'), stubContext);
    assert.equal(r.output, 'monster');
  });

  it('routes Feats.aspx to feat', async () => {
    const r = await detectTypeNode.execute(urlState('https://2e.aonprd.com/Feats.aspx?ID=1'), stubContext);
    assert.equal(r.output, 'feat');
  });

  it('routes Weapons.aspx to weapon', async () => {
    const r = await detectTypeNode.execute(urlState('https://2e.aonprd.com/Weapons.aspx?ID=1'), stubContext);
    assert.equal(r.output, 'weapon');
  });

  it('routes Armor.aspx to armor', async () => {
    const r = await detectTypeNode.execute(urlState('https://2e.aonprd.com/Armor.aspx?ID=1'), stubContext);
    assert.equal(r.output, 'armor');
  });

  it('routes Shields.aspx to armor (shield sub-type)', async () => {
    const r = await detectTypeNode.execute(urlState('https://2e.aonprd.com/Shields.aspx?ID=1'), stubContext);
    assert.equal(r.output, 'armor');
  });

  it('routes Equipment.aspx to equipment', async () => {
    const r = await detectTypeNode.execute(urlState('https://2e.aonprd.com/Equipment.aspx?ID=1'), stubContext);
    assert.equal(r.output, 'equipment');
  });

  it('routes Actions.aspx to action', async () => {
    const r = await detectTypeNode.execute(urlState('https://2e.aonprd.com/Actions.aspx?ID=1'), stubContext);
    assert.equal(r.output, 'action');
  });

  it('routes Ancestries.aspx to ancestry', async () => {
    const r = await detectTypeNode.execute(urlState('https://2e.aonprd.com/Ancestries.aspx?ID=1'), stubContext);
    assert.equal(r.output, 'ancestry');
  });

  it('routes Classes.aspx to class', async () => {
    const r = await detectTypeNode.execute(urlState('https://2e.aonprd.com/Classes.aspx?ID=1'), stubContext);
    assert.equal(r.output, 'class');
  });

  it('routes Backgrounds.aspx to background', async () => {
    const r = await detectTypeNode.execute(urlState('https://2e.aonprd.com/Backgrounds.aspx?ID=1'), stubContext);
    assert.equal(r.output, 'background');
  });

  it('routes Conditions.aspx to condition', async () => {
    const r = await detectTypeNode.execute(urlState('https://2e.aonprd.com/Conditions.aspx?ID=1'), stubContext);
    assert.equal(r.output, 'condition');
  });

  it('routes Traits.aspx to trait', async () => {
    const r = await detectTypeNode.execute(urlState('https://2e.aonprd.com/Traits.aspx?ID=1'), stubContext);
    assert.equal(r.output, 'trait');
  });

  it('routes Hazards.aspx to hazard', async () => {
    const r = await detectTypeNode.execute(urlState('https://2e.aonprd.com/Hazards.aspx?ID=1'), stubContext);
    assert.equal(r.output, 'hazard');
  });

  it('routes Deities.aspx to generic', async () => {
    const r = await detectTypeNode.execute(urlState('https://2e.aonprd.com/Deities.aspx?ID=1'), stubContext);
    assert.equal(r.output, 'generic');
  });

  it('routes Archetypes.aspx to generic', async () => {
    const r = await detectTypeNode.execute(urlState('https://2e.aonprd.com/Archetypes.aspx?ID=1'), stubContext);
    assert.equal(r.output, 'generic');
  });

  it('routes Languages.aspx to generic', async () => {
    const r = await detectTypeNode.execute(urlState('https://2e.aonprd.com/Languages.aspx?ID=1'), stubContext);
    assert.equal(r.output, 'generic');
  });

  it('routes URL with no aspx path to unknown', async () => {
    const r = await detectTypeNode.execute(urlState('https://2e.aonprd.com/'), stubContext);
    assert.equal(r.output, 'unknown');
  });
});
