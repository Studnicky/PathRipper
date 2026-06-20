/**
 * Outcomes block parser — unit tests.
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { parseOutcomesBlock, outcomesBlockToCampActivity } from '../../../../../plugins/aonprd/capabilities/outcomesBlock.js';

describe('outcomesBlock', () => {
  describe('parseOutcomesBlock', () => {
    it('parses all four outcomes', () => {
      const html = `
        <p>Description prose.</p>
        <b>Critical Success</b> The target is unaffected.
        <b>Success</b> The target takes damage.
        <b>Failure</b> The target takes double damage.
        <b>Critical Failure</b> The target is destroyed.
      `;
      const result = parseOutcomesBlock(html);
      assert.equal(result.critical_success, 'The target is unaffected.');
      assert.equal(result.success, 'The target takes damage.');
      assert.equal(result.failure, 'The target takes double damage.');
      assert.equal(result.critical_failure, 'The target is destroyed.');
    });

    it('handles missing outcomes (returns null)', () => {
      const html = `
        <p>Description.</p>
        <b>Success</b> This succeeds.
        <b>Failure</b> This fails.
      `;
      const result = parseOutcomesBlock(html);
      assert.equal(result.critical_success, null);
      assert.equal(result.success, 'This succeeds.');
      assert.equal(result.failure, 'This fails.');
      assert.equal(result.critical_failure, null);
    });

    it('stops at <hr /> boundary', () => {
      const html = `
        <b>Critical Success</b> Good outcome.
        <b>Success</b> OK outcome.
        <hr />
        <p>Continued prose (not parsed as outcomes).</p>
        <b>Critical Success</b> This is outside the scope.
      `;
      const result = parseOutcomesBlock(html);
      assert.equal(result.critical_success, 'Good outcome.');
      assert.equal(result.success, 'OK outcome.');
    });

    it('extracts text body until next outcome marker', () => {
      const html = `
        <b>Critical Success</b> First line. More detail here.
        <b>Success</b> Second outcome.
      `;
      const result = parseOutcomesBlock(html);
      assert.equal(result.critical_success, 'First line. More detail here.');
      assert.equal(result.success, 'Second outcome.');
    });

    it('ignores empty outcome bodies', () => {
      const html = `
        <b>Critical Success</b>
        <b>Success</b> Some text.
      `;
      const result = parseOutcomesBlock(html);
      assert.equal(result.critical_success, null);
      assert.equal(result.success, 'Some text.');
    });

    it('handles HTML markup within outcome bodies', () => {
      const html = `
        <b>Success</b> Target takes <em>1d6</em> fire damage.
      `;
      const result = parseOutcomesBlock(html);
      assert.equal(result.success, 'Target takes 1d6 fire damage.');
    });

    it('case-insensitive matching', () => {
      const html = `
        <b>critical success</b> Works.
        <b>SUCCESS</b> Also works.
      `;
      const result = parseOutcomesBlock(html);
      assert.equal(result.critical_success, 'Works.');
      assert.equal(result.success, 'Also works.');
    });

    it('handles whitespace in outcome labels', () => {
      const html = `
        <b>Critical   Success</b> Extra spaces.
        <b>Critical Failure</b> Also works.
      `;
      const result = parseOutcomesBlock(html);
      assert.equal(result.critical_success, 'Extra spaces.');
      assert.equal(result.critical_failure, 'Also works.');
    });

    it('returns all nulls for no outcomes found', () => {
      const html = '<p>Just description, no outcomes.</p>';
      const result = parseOutcomesBlock(html);
      assert.equal(result.critical_success, null);
      assert.equal(result.success, null);
      assert.equal(result.failure, null);
      assert.equal(result.critical_failure, null);
    });

    it('stops at next outcome marker (order-independent)', () => {
      const html = `
        <b>Failure</b> Takes damage. More text about failure.
        <b>Success</b> Next tier (text before Success marker should stop reading Failure).
      `;
      const result = parseOutcomesBlock(html);
      assert.equal(result.failure, 'Takes damage. More text about failure.');
      assert.equal(result.success, 'Next tier (text before Success marker should stop reading Failure).');
    });
  });

  describe('outcomesBlockToCampActivity', () => {
    it('converts all outcomes to camp-activity format', () => {
      const outcomes = {
        critical_success: 'Great!',
        success: 'OK.',
        failure: 'Bad.',
        critical_failure: 'Terrible!',
      };
      const result = outcomesBlockToCampActivity(outcomes);
      assert.deepEqual(result, [
        { tier: 'critical-success', text: 'Great!' },
        { tier: 'success', text: 'OK.' },
        { tier: 'failure', text: 'Bad.' },
        { tier: 'critical-failure', text: 'Terrible!' },
      ]);
    });

    it('omits null outcomes', () => {
      const outcomes = {
        critical_success: null,
        success: 'OK.',
        failure: null,
        critical_failure: 'Terrible!',
      };
      const result = outcomesBlockToCampActivity(outcomes);
      assert.deepEqual(result, [
        { tier: 'success', text: 'OK.' },
        { tier: 'critical-failure', text: 'Terrible!' },
      ]);
    });

    it('returns empty array when all outcomes are null', () => {
      const outcomes = {
        critical_success: null,
        success: null,
        failure: null,
        critical_failure: null,
      };
      const result = outcomesBlockToCampActivity(outcomes);
      assert.deepEqual(result, []);
    });

    it('preserves outcome order', () => {
      const outcomes = {
        critical_success: 'A',
        success: 'B',
        failure: 'C',
        critical_failure: 'D',
      };
      const result = outcomesBlockToCampActivity(outcomes);
      assert.equal(result[0]?.tier, 'critical-success');
      assert.equal(result[1]?.tier, 'success');
      assert.equal(result[2]?.tier, 'failure');
      assert.equal(result[3]?.tier, 'critical-failure');
    });
  });
});
