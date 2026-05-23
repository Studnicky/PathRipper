// Unit tests for article concept capability nodes (Phase 6.4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode }           from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { sectionWalkerNode }           from '../../../../../plugins/aonprd/capabilities/sectionWalker.js';
import { labelPairBlockNode }          from '../../../../../plugins/aonprd/capabilities/labelPairBlock.js';
import { sourceRefNode }               from '../../../../../plugins/aonprd/capabilities/sourceRef.js';
import {
  articleBaseNode,
  finalizeArticleNode,
} from '../../../../../plugins/aonprd/concepts/article.js';
import type { ArticleOutput } from '../../../../../plugins/aonprd/concepts/article.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

async function primeState(fixtureName: string, url: string) {
  const html  = await loadFixture(fixtureName);
  const state = makeState(html, url);
  await loadAndCommonNode.execute(state, stubContext);
  await labelPairBlockNode.execute(state, stubContext);
  await sectionWalkerNode.execute(state, stubContext);
  await sourceRefNode.execute(state, stubContext);
  return state;
}

async function primeAndRunFull(fixtureName: string, url: string) {
  const state = await primeState(fixtureName, url);
  await articleBaseNode.execute(state, stubContext);
  await finalizeArticleNode.execute(state, stubContext);
  return state.output as ArticleOutput;
}

describe('extract:article-base — article-walkena', () => {
  it('produces _type, name, article_id, description', async () => {
    const state = await primeState('article-walkena.html', 'https://2e.aonprd.com/Articles.aspx?ID=1');
    const r = await articleBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as ArticleOutput;
    assert.equal(out._type, 'article');
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name should be non-empty');
    assert.equal(out.article_id, 1);
    // description is body text; may be null for minimal pages
    assert.ok('description' in out, 'description field missing');
  });

  it('error path — returns error when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Articles.aspx?ID=1');
    const r = await articleBaseNode.execute(state, stubContext);
    assert.equal(r.output, 'error');
  });
});

describe('finalize:article — article-walkena', () => {
  it('produces sections, raw_fields, links, body_text', async () => {
    const state = await primeState('article-walkena.html', 'https://2e.aonprd.com/Articles.aspx?ID=1');
    await articleBaseNode.execute(state, stubContext);
    const r = await finalizeArticleNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const out = state.output as ArticleOutput;
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
    assert.ok(Array.isArray(out.links), 'links missing');
    assert.ok(typeof out.body_text === 'string', 'body_text missing');
  });

  it('error path — soft-fails to success when prerequisites missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Articles.aspx?ID=1');
    const r = await finalizeArticleNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
  });
});

describe('full article pipeline — article-walkena', () => {
  it('produces complete ArticleOutput', async () => {
    const out = await primeAndRunFull('article-walkena.html', 'https://2e.aonprd.com/Articles.aspx?ID=1');
    assert.equal(out._type, 'article');
    assert.equal(out.article_id, 1);
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
    assert.ok(Array.isArray(out.sections), 'sections missing');
    assert.ok(typeof out.raw_fields === 'object', 'raw_fields missing');
  });
});

describe('full article pipeline — article-swardlands-gazetteer', () => {
  it('produces valid ArticleOutput', async () => {
    const out = await primeAndRunFull('article-swardlands-gazetteer.html', 'https://2e.aonprd.com/Articles.aspx?ID=2');
    assert.equal(out._type, 'article');
    assert.ok(typeof out.name === 'string' && out.name.length > 0, 'name missing');
  });
});
