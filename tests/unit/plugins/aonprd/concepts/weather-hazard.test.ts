// Unit tests for weather-hazard concept capability nodes.
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  weatherHazardBaseNode,
  finalizeWeatherHazardNode,
} from '../../../../../plugins/aonprd/concepts/weather-hazard.js';
import type { WeatherHazardOutput } from '../../../../../plugins/aonprd/concepts/weather-hazard.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';
import { ParsedOutput } from '../../../../helpers/ParsedOutput.js';

async function primeState(fixtureName: string, url: string) {
  const html  = await loadFixture(fixtureName);
  const state = makeState(html, url);
  await loadAndCommonNode.execute(Batch.of(state), stubContext);
  await labelPairBlockNode.execute(Batch.of(state), stubContext);
  await sectionWalkerNode.execute(Batch.of(state), stubContext);
  await sourceRefNode.execute(Batch.of(state), stubContext);
  return state;
}

async function primeAndRunFull(fixtureName: string, url: string) {
  const state = await primeState(fixtureName, url);
  await weatherHazardBaseNode.execute(Batch.of(state), stubContext);
  await finalizeWeatherHazardNode.execute(Batch.of(state), stubContext);
  return ParsedOutput.as<WeatherHazardOutput>(state.output);
}

describe('extract:weather-hazard-base — weather-hazard-blizzard', () => {
  it('produces _type, name, weather_hazard_id, effects[]', async () => {
    const state = await primeState('weather-hazard-blizzard.html', 'https://2e.aonprd.com/WeatherHazards.aspx?ID=1');
    const result = await weatherHazardBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<WeatherHazardOutput>(state.output);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
    assert.equal(out.weather_hazard_id, 1);
    assert.ok(Array.isArray(out.effects), 'effects should be an array');
  });

  it('blizzard has labelled effects', async () => {
    const state = await primeState('weather-hazard-blizzard.html', 'https://2e.aonprd.com/WeatherHazards.aspx?ID=1');
    await weatherHazardBaseNode.execute(Batch.of(state), stubContext);

    const out = ParsedOutput.as<WeatherHazardOutput>(state.output);
    assert.ok(out.effects.length > 0, 'blizzard should have effects');
    const firstEffect = out.effects[0];
    assert.ok(firstEffect !== undefined, 'no effects in list');
    assert.ok(typeof firstEffect.name === 'string' && firstEffect.name.length > 0, 'effect.name missing');
    assert.ok(typeof firstEffect.body === 'string' && firstEffect.body.length > 0, 'effect.body missing');
  });

  it('error path — returns error when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/WeatherHazards.aspx?ID=1');
    const result = await weatherHazardBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('finalize:weather-hazard — weather-hazard-blizzard', () => {
  it('produces sections, raw_fields, links, body_text', async () => {
    const state = await primeState('weather-hazard-blizzard.html', 'https://2e.aonprd.com/WeatherHazards.aspx?ID=1');
    await weatherHazardBaseNode.execute(Batch.of(state), stubContext);
    const result = await finalizeWeatherHazardNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<WeatherHazardOutput>(state.output);
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
  });

  it('sections[] does not contain legacy-content-warning', async () => {
    const out = await primeAndRunFull('weather-hazard-blizzard.html', 'https://2e.aonprd.com/WeatherHazards.aspx?ID=1');
    const legacySection = out.sections.find((sec) =>
      /legacy[\s-]content[\s-]warning/i.test(sec.heading),
    );
    assert.equal(legacySection, undefined, 'legacy-content-warning section should be filtered');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/WeatherHazards.aspx?ID=1');
    const result = await finalizeWeatherHazardNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));
  });
});

describe('full weather-hazard pipeline — weather-hazard-blizzard', () => {
  it('produces complete WeatherHazardOutput', async () => {
    const out = await primeAndRunFull('weather-hazard-blizzard.html', 'https://2e.aonprd.com/WeatherHazards.aspx?ID=1');
    assert.equal(out.weather_hazard_id, 1);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(Array.isArray(out.effects), 'effects missing');
    assert.ok(out.effects.length > 0, 'blizzard should have effects');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
  });
});
