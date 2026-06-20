import { describe, it } from 'node:test';
import * as assert from 'node:assert';

import { parseAfflictionStages } from '../../../../../plugins/aonprd/capabilities/afflictionStages.js';

describe('parseAfflictionStages', () => {
  it('parses single stage with body text and duration', () => {
    const html = '<b>Stage 1</b> The target takes 1d4 poison damage. (1 day)';
    const result = parseAfflictionStages(html);
    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(result[0], {
      stage: 1,
      body_text: 'The target takes 1d4 poison damage.',
      duration: '1 day',
    });
  });

  it('parses stage without duration', () => {
    const html = '<b>Stage 2</b> The target is sickened 2.';
    const result = parseAfflictionStages(html);
    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(result[0], {
      stage: 2,
      body_text: 'The target is sickened 2.',
      duration: null,
    });
  });

  it('parses multiple stages in order', () => {
    const html = `
      <b>Stage 1</b> Effect one. (1 round)
      <b>Stage 2</b> Effect two. (10 minutes)
      <b>Stage 3</b> Effect three.
    `;
    const result = parseAfflictionStages(html);
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0]?.stage, 1);
    assert.strictEqual(result[1]?.stage, 2);
    assert.strictEqual(result[2]?.stage, 3);
    assert.strictEqual(result[0]?.duration, '1 round');
    assert.strictEqual(result[1]?.duration, '10 minutes');
    assert.strictEqual(result[2]?.duration, null);
  });

  it('stops at hr boundary', () => {
    const html = `<b>Stage 1</b> First stage text.<hr /><b>Stage 2</b> Should not be parsed.`;
    const result = parseAfflictionStages(html);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]?.stage, 1);
  });

  it('stops at heading boundary', () => {
    const html = `<b>Stage 1</b> Stage one.<h3>New Section</h3><b>Stage 2</b> Should not be parsed.`;
    const result = parseAfflictionStages(html);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]?.stage, 1);
  });

  it('returns empty array for no stage markers', () => {
    const html = '<p>This affliction has no stages defined.</p>';
    const result = parseAfflictionStages(html);
    assert.strictEqual(result.length, 0);
  });

  it('handles whitespace around stage markers', () => {
    const html = '<b>  Stage  4  </b> Some effect. (2 hours)';
    const result = parseAfflictionStages(html);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]?.stage, 4);
    assert.strictEqual(result[0]?.duration, '2 hours');
  });

  it('strips leading and trailing whitespace from body text', () => {
    const html = '<b>Stage 1</b>   Body text with padding.   ';
    const result = parseAfflictionStages(html);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]?.body_text, 'Body text with padding.');
  });

  it('extracts duration from trailing parenthetical only', () => {
    const html = '<b>Stage 1</b> Effect (with parens) in body (1 day)';
    const result = parseAfflictionStages(html);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]?.body_text, 'Effect (with parens) in body');
    assert.strictEqual(result[0]?.duration, '1 day');
  });

  it('handles HTML tags in stage body', () => {
    const html = '<b>Stage 2</b> The target is <i>blinded</i> and <b>enfeebled</b> 1. (8 rounds)';
    const result = parseAfflictionStages(html);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]?.body_text.includes('blinded'), true);
    assert.strictEqual(result[0]?.body_text.includes('enfeebled'), true);
    assert.strictEqual(result[0]?.duration, '8 rounds');
  });
});
