// Unit tests for domain concept capability nodes (Phase 6.4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }  from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import {
  domainBaseNode,
  domainSpellsNode,
  domainMetaNode,
  finalizeDomainNode,
} from '../../../../../plugins/aonprd/concepts/domain.js';
import type { DomainOutput } from '../../../../../plugins/aonprd/concepts/domain.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

const FIXTURE     = 'domain-zeal.html';
const URL         = 'https://2e.aonprd.com/Domains.aspx?ID=100';

const AIR_FIXTURE = 'domain-air.html';
const AIR_URL     = 'https://2e.aonprd.com/Domains.aspx?ID=2';

async function primeState(fixture: string = FIXTURE, url: string = URL) {
  const html  = await loadFixture(fixture);
  const state = makeState(html, url);
  await loadAndCommonNode.execute(state, stubContext);
  return state;
}

async function primeAndRunFull(fixture: string = FIXTURE, url: string = URL) {
  const state = await primeState(fixture, url);
  await domainBaseNode.execute(state, stubContext);
  await domainSpellsNode.execute(state, stubContext);
  await domainMetaNode.execute(state, stubContext);
  await finalizeDomainNode.execute(state, stubContext);
  return state.output as DomainOutput;
}

describe('extract:domain-base — domain-zeal', () => {
  it('produces _type, name, domain_id, rarity, sources', async () => {
    const state = await primeState();
    const r = await domainBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as DomainOutput;
    assert.equal(out.domain_id, 100);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name non-empty');
    assert.ok(typeof out.rarity === 'string', 'rarity is string');
    assert.ok(Array.isArray(out.traits), 'traits is array');
    assert.ok(out.source !== undefined, 'source present');
    assert.ok(Array.isArray(out.sources), 'sources is array');
    assert.ok('legacy' in out, 'legacy field present');
    assert.ok('alt_edition_url' in out, 'alt_edition_url present');
    assert.ok('pfs' in out, 'pfs field present');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const r = await domainBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:domain-spells — domain-zeal', () => {
  it('produces domain_spell and advanced_domain_spell', async () => {
    const state = await primeState();
    await domainBaseNode.execute(state, stubContext);
    const r = await domainSpellsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as DomainOutput;
    assert.ok(out.domain_spell !== null, 'domain_spell present');
    assert.equal(out.domain_spell?.name, 'Weapon Surge');
    assert.equal(out.domain_spell?.spell_id, 1852);
    assert.ok(out.advanced_domain_spell !== null, 'advanced_domain_spell present');
    assert.equal(out.advanced_domain_spell?.name, 'Zeal for Battle');
    assert.equal(out.advanced_domain_spell?.spell_id, 1853);
    assert.ok('apocryphal' in out, 'apocryphal key present');
  });

  it('parses Apocryphal Domain Spells subsection (domain-air)', async () => {
    const state = await primeState(AIR_FIXTURE, AIR_URL);
    await domainBaseNode.execute(state, stubContext);
    await domainSpellsNode.execute(state, stubContext);

    const out = state.output as DomainOutput;
    assert.ok(out.apocryphal !== null, 'apocryphal block present for Air');
    assert.equal(out.apocryphal?.apocryphal_domain_spell, null, 'em-dash apocryphal entry is null');
    assert.ok(out.apocryphal?.apocryphal_advanced_domain_spell !== null, 'apocryphal advanced spell present');
    assert.equal(out.apocryphal?.apocryphal_advanced_domain_spell?.name, 'Wind Whispers');
    assert.equal(out.apocryphal?.apocryphal_advanced_domain_spell?.spell_id, 1178);
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const r = await domainSpellsNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('extract:domain-meta — domain-zeal', () => {
  it('produces description, deities_using, sections', async () => {
    const state = await primeState();
    await domainBaseNode.execute(state, stubContext);
    const r = await domainMetaNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as DomainOutput;
    assert.ok(typeof out.description_text === 'string' && out.description_text.length > 0, 'description_text non-empty');
    assert.ok(typeof out.description_html === 'string', 'description_html is string');
    assert.ok(Array.isArray(out.sections), 'sections is array');
    assert.ok(Array.isArray(out.deities_using), 'deities_using is array');
    assert.ok(out.deities_using.length > 0, 'deities_using non-empty');
    const names = out.deities_using.map((d) => d.name);
    assert.ok(names.includes('Iomedae'), 'Iomedae present in deities_using');
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', URL);
    const r = await domainMetaNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('finalize:domain — domain-zeal', () => {
  it('assembles complete DomainOutput with all required fields', async () => {
    const out = await primeAndRunFull();
    assert.equal(out.domain_id, 100);
    assert.ok(out.domain_spell !== null, 'domain_spell carried through');
    assert.ok(out.advanced_domain_spell !== null, 'advanced_domain_spell carried through');
    assert.ok(Array.isArray(out.deities_using), 'deities_using present');
    assert.ok(Array.isArray(out.sections), 'sections present');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields present');
    assert.ok(Array.isArray(out.links), 'links present');
    assert.ok('meta_description' in out, 'meta_description present');
    assert.ok('meta_keywords' in out, 'meta_keywords present');
  });

  it('strips claimed AON labels from raw_fields', async () => {
    const out = await primeAndRunFull();
    for (const claimed of ['Source', 'Deities', 'Domain Spell', 'Advanced Domain Spell']) {
      assert.equal(out.raw_fields[claimed], undefined, `${claimed} should be stripped`);
    }
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const html  = await loadFixture(FIXTURE);
    const state = makeState(html, URL);
    await loadAndCommonNode.execute(state, stubContext);
    const r = await finalizeDomainNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});
