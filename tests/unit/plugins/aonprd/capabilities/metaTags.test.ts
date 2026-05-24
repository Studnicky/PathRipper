// Unit tests for `extract:meta-tags` capability.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadAndCommonNode } from '../../../../../plugins/aonprd/nodes/loadAndCommon.js';
import { metaTagsNode } from '../../../../../plugins/aonprd/capabilities/metaTags.js';
import type { AonprdMetaTags } from '../../../../../plugins/aonprd/capabilities/metaTags.js';
import { loadFixture, makeState, stubContext } from '../nodes/helpers.js';

describe('extract:meta-tags — language-common fixture', () => {
  it('extracts description and keywords from <meta> tags into aonprdMetaTags', async () => {
    const html  = await loadFixture('language-common.html');
    const state = makeState(html, 'https://2e.aonprd.com/Languages.aspx?ID=1');
    await loadAndCommonNode.execute(state, stubContext);
    const r = await metaTagsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');

    const meta = state.getMetadata<AonprdMetaTags>('aonprdMetaTags');
    assert.ok(meta !== undefined, 'aonprdMetaTags missing on state');
    // description and keywords are either non-empty strings or null when AON omits them.
    assert.ok(meta.description === null || typeof meta.description === 'string', 'description shape');
    assert.ok(meta.keywords    === null || typeof meta.keywords    === 'string', 'keywords shape');
  });

  it('soft-fails to success with no metadata when aonprdCheerio is missing', async () => {
    const state = makeState('', 'https://2e.aonprd.com/Languages.aspx?ID=1');
    const r = await metaTagsNode.execute(state, stubContext);
    assert.equal(r.output, 'success');
    assert.equal(state.getMetadata('aonprdMetaTags'), undefined);
  });
});
