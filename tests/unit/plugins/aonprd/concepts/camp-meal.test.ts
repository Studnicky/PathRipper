// Unit tests for camp-meal concept capability nodes (Phase 6.4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }       from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import {
  campMealBaseNode,
  campMealMechanicsNode,
  finalizeCampMealNode,
} from '../../../../../plugins/aonprd/concepts/camp-meal.js';
import type { CampMealOutput } from '../../../../../plugins/aonprd/concepts/camp-meal.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

const FIXTURE = 'camp-meal-baked-spider-legs.html';
const URL     = 'https://2e.aonprd.com/CampMeals.aspx?ID=1';

async function primeState() {
  const html  = await loadFixture(FIXTURE);
  const state = makeState(html, URL);
  await loadAndCommonNode.execute(state, stubContext);
  return state;
}

async function primeAndRunFull() {
  const state = await primeState();
  await campMealBaseNode.execute(state, stubContext);
  await campMealMechanicsNode.execute(state, stubContext);
  await finalizeCampMealNode.execute(state, stubContext);
  return state.output as CampMealOutput;
}

describe('extract:camp-meal-base — camp-meal-baked-spider-legs', () => {
  it('produces _type, name, meal_id', async () => {
    const state = await primeState();
    const r = await campMealBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as CampMealOutput;
    assert.equal(out.name, 'Baked Spider Legs');
    assert.equal(out.meal_id, 1);
    assert.ok(Array.isArray(out.traits), 'traits is array');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const r = await campMealBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:camp-meal-mechanics — camp-meal-baked-spider-legs', () => {
  it('produces outcomes array and description', async () => {
    const state = await primeState();
    await campMealBaseNode.execute(state, stubContext);
    const r = await campMealMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as CampMealOutput;
    assert.ok(Array.isArray(out.outcomes), 'outcomes is array');
    assert.ok(out.outcomes.length > 0, 'at least one outcome parsed');
    assert.ok(typeof out.description === 'string', 'description is string');
    assert.ok('recipe_price' in out, 'recipe_price field present');
    assert.ok('ingredients' in out, 'ingredients field present');
    assert.ok('preparation' in out, 'preparation field present');
    assert.ok('favorite_meal' in out, 'favorite_meal field present');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const r = await campMealMechanicsNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('finalize:camp-meal — camp-meal-baked-spider-legs', () => {
  it('assembles complete CampMealOutput with all required fields', async () => {
    const out = await primeAndRunFull();
    assert.equal(out.name, 'Baked Spider Legs');
    assert.equal(out.meal_id, 1);
    assert.ok(Array.isArray(out.outcomes), 'outcomes present');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields present');
    assert.ok(typeof out.body_html === 'string', 'body_html present');
    assert.ok(Array.isArray(out.links), 'links present');
    assert.ok('meta_description' in out, 'meta_description present');
    assert.ok('meta_keywords' in out, 'meta_keywords present');
    assert.ok(Array.isArray(out.sections), 'sections present');
  });

  it('strips claimed AON labels from raw_fields', async () => {
    const out = await primeAndRunFull();
    assert.equal(out.raw_fields['Source'], undefined, 'Source stripped');
    assert.equal(out.raw_fields['Recipe Price'], undefined, 'Recipe Price stripped');
    assert.equal(out.raw_fields['Ingredients'], undefined, 'Ingredients stripped');
    assert.equal(out.raw_fields['Critical Success'], undefined, 'Critical Success stripped');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', URL);
    const r = await finalizeCampMealNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});
