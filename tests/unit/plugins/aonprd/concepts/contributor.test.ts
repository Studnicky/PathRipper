// Unit tests for contributor concept capability nodes.
import { describe, it } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  contributorBaseNode,
  contributorProfileNode,
  finalizeContributorNode,
} from '../../../../../plugins/aonprd/concepts/contributor.js';
import type { ContributorOutput } from '../../../../../plugins/aonprd/concepts/contributor.js';
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
  await contributorBaseNode.execute(Batch.of(state), stubContext);
  await contributorProfileNode.execute(Batch.of(state), stubContext);
  await finalizeContributorNode.execute(Batch.of(state), stubContext);
  return ParsedOutput.as<ContributorOutput>(state.output);
}

describe('extract:contributor-base — contributor-devin', () => {
  it('produces _type, name, contributor_id', async () => {
    const state = await primeState('contributor-devin.html', 'https://2e.aonprd.com/Contributors.aspx?ID=1');
    const result = await contributorBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<ContributorOutput>(state.output);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
    assert.equal(out.contributor_id, 1);
  });

  it('error path — returns error when aonprdCommon missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Contributors.aspx?ID=1');
    const result = await contributorBaseNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('extract:contributor-profile — contributor-devin', () => {
  it('produces bio_html and bio_text', async () => {
    const state = await primeState('contributor-devin.html', 'https://2e.aonprd.com/Contributors.aspx?ID=1');
    await contributorBaseNode.execute(Batch.of(state), stubContext);
    const result = await contributorProfileNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<ContributorOutput>(state.output);
    assert.ok(typeof out.bio_html === 'string', 'bio_html missing');
    assert.ok(typeof out.bio_text === 'string', 'bio_text missing');
  });

  it('error path — returns error when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Contributors.aspx?ID=1');
    const result = await contributorProfileNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('error'));
  });
});

describe('finalize:contributor — contributor-devin', () => {
  it('produces sections, raw_fields, links, body_text', async () => {
    const state = await primeState('contributor-devin.html', 'https://2e.aonprd.com/Contributors.aspx?ID=1');
    await contributorBaseNode.execute(Batch.of(state), stubContext);
    await contributorProfileNode.execute(Batch.of(state), stubContext);
    const result = await finalizeContributorNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));

    const out = ParsedOutput.as<ContributorOutput>(state.output);
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Contributors.aspx?ID=1');
    const result = await finalizeContributorNode.execute(Batch.of(state), stubContext);
    assert.ok(result.has('success'));
  });
});

describe('full contributor pipeline — contributor-devin', () => {
  it('produces complete ContributorOutput', async () => {
    const out = await primeAndRunFull('contributor-devin.html', 'https://2e.aonprd.com/Contributors.aspx?ID=1');
    assert.equal(out.contributor_id, 1);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(typeof out.bio_html === 'string', 'bio_html missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
  });
});

describe('full contributor pipeline — contributor-milan', () => {
  it('produces valid ContributorOutput', async () => {
    const out = await primeAndRunFull('contributor-milan.html', 'https://2e.aonprd.com/Contributors.aspx?ID=2');
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
  });
});
