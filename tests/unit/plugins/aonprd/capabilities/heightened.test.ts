import { describe, it } from 'node:test';
import * as assert from 'node:assert';

import { parseHeightened } from '../../../../../plugins/aonprd/capabilities/heightened.js';

describe('parseHeightened', () => {
  it('parses single heightened block with ordinal rank', () => {
    const html = '<b>Heightened (5th)</b> Some heightened effect text.';
    const result = parseHeightened(html);
    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(result[0], {
      rank_label: '5th',
      rank: 5,
      increment: null,
      body_html: 'Some heightened effect text.',
      body_text: 'Some heightened effect text.',
    });
  });

  it('parses heightened block with increment notation', () => {
    const html = '<b>Heightened (+2)</b> Increase the damage by 2d6.';
    const result = parseHeightened(html);
    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(result[0], {
      rank_label: '+2',
      rank: null,
      increment: 2,
      body_html: 'Increase the damage by 2d6.',
      body_text: 'Increase the damage by 2d6.',
    });
  });

  it('parses multiple heightened blocks in order', () => {
    const html = `
      <b>Heightened (3rd)</b> First heightened text.
      <b>Heightened (5th)</b> Second heightened text.
    `;
    const result = parseHeightened(html);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0]?.rank, 3);
    assert.strictEqual(result[1]?.rank, 5);
    assert.strictEqual(result[0]?.body_text.includes('First heightened'), true);
    assert.strictEqual(result[1]?.body_text.includes('Second heightened'), true);
  });

  it('strips trailing empty ul placeholders', () => {
    const html = '<b>Heightened (6th)</b> Effect text<ul></ul>';
    const result = parseHeightened(html);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]?.body_html, 'Effect text');
  });

  it('parses numeric rank notation', () => {
    const html = '<b>Heightened (7)</b> At rank 7.';
    const result = parseHeightened(html);
    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(result[0], {
      rank_label: '7',
      rank: 7,
      increment: null,
      body_html: 'At rank 7.',
      body_text: 'At rank 7.',
    });
  });

  it('returns empty array for no heightened markers', () => {
    const html = '<p>This has no heightened blocks at all.</p>';
    const result = parseHeightened(html);
    assert.strictEqual(result.length, 0);
  });

  it('handles whitespace in heightened marker', () => {
    const html = '<b>  Heightened  (  4th  )  </b> Some text.';
    const result = parseHeightened(html);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]?.rank_label, '4th');
    assert.strictEqual(result[0]?.rank, 4);
  });

  it('stops at the next heightened block or end of HTML', () => {
    const html = `<b>Heightened (2nd)</b> This is the second level effect.
      Some more details here. <b>Heightened (4th)</b> This starts the next one.`;
    const result = parseHeightened(html);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0]?.body_text.includes('second level'), true);
    assert.strictEqual(result[0]?.body_text.includes('next one'), false);
  });
});
