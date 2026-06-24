// Unit tests for subclass-feature/helpers.ts — isFlavorBoldLabel (ReDoS fix).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isFlavorBoldLabel } from '../../../../../plugins/aonprd/concepts/subclass-feature/helpers.js';

describe('isFlavorBoldLabel — legitimate names (should return true)', () => {
  it('recognises a two-word Title-Case name', () => {
    assert.equal(isFlavorBoldLabel('Queen Galfrey'), true);
  });

  it('recognises a name with a period abbreviation (Dr.)', () => {
    assert.equal(isFlavorBoldLabel('Dr. Ashley Arrowbaud'), true);
  });

  it('recognises a hyphenated Title-Case name (Half-Elf)', () => {
    assert.equal(isFlavorBoldLabel('Half-Elf'), true);
  });

  it('recognises a name with lowercase connector (van, of, the)', () => {
    assert.equal(isFlavorBoldLabel('Queen of Hearts'), true);
  });

  it('recognises a single Title-Case proper name (Moloch)', () => {
    assert.equal(isFlavorBoldLabel('Moloch'), true);
  });

  it('recognises an adventure product ID (SC- 04910)', () => {
    assert.equal(isFlavorBoldLabel('SC- 04910'), true);
  });
});

describe('isFlavorBoldLabel — should return false for non-name labels', () => {
  it('rejects a plain lowercase word', () => {
    assert.equal(isFlavorBoldLabel('damage'), false);
  });

  it('rejects a two-character string', () => {
    assert.equal(isFlavorBoldLabel('ab'), false);
  });

  it('rejects an empty string', () => {
    assert.equal(isFlavorBoldLabel(''), false);
  });

  it('rejects ALL-CAPS acronym', () => {
    assert.equal(isFlavorBoldLabel('HP'), false);
  });
});

describe('isFlavorBoldLabel — ReDoS regression (must complete near-instantly)', () => {
  it('does not hang on a long repeated ambiguous separator sequence', () => {
    // Prior regex had overlapping ' and - in both word class [A-Za-z'.-]
    // and separator class [ '-], causing catastrophic backtracking.
    // This input forces maximum backtracking on the vulnerable pattern.
    const redosInput = "A' A' A' A' A' A' A' A' A' A' A' A' A' A' A' A' A' A' A' A'X";
    const start = Date.now();
    isFlavorBoldLabel(redosInput);
    const elapsed = Date.now() - start;
    // Should complete in well under 1 second on any machine; catastrophic
    // backtracking on the old regex would take many seconds or timeout.
    assert.ok(elapsed < 500, `ReDoS triggered: took ${elapsed}ms`);
  });

  it('does not hang on long hyphen-separated input', () => {
    const redosInput = 'A-A-A-A-A-A-A-A-A-A-A-A-A-A-A-A-A-A-A-AX';
    const start = Date.now();
    isFlavorBoldLabel(redosInput);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 500, `ReDoS triggered: took ${elapsed}ms`);
  });
});
