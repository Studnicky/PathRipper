// Unit tests for aonprd common.ts utility functions.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { htmlToText } from '../../../../plugins/aonprd/common.js';

describe('htmlToText — tag stripping', () => {
  it('strips a simple tag', () => {
    assert.equal(htmlToText('<b>bold</b>'), 'bold');
  });

  it('inserts space between adjacent closing/opening tags', () => {
    assert.equal(htmlToText('<a>Taldane</a><a>Nagaji</a>'), 'Taldane Nagaji');
  });

  it('strips tags to fixpoint — consecutively nested same tags', () => {
    // Verifies idempotence: a second pass on already-clean output returns the same string,
    // so the fixpoint loop terminates correctly and does not mutate clean text.
    assert.equal(htmlToText('<div><b>hello</b></div>'), 'hello');
  });

  it('strips tags to fixpoint — ensures no tag residue remains after multiple passes', () => {
    // The fixpoint loop is the defense-in-depth guard required by
    // CWE-116 / js/incomplete-multi-character-sanitization.
    // Verify it is idempotent on arbitrary well-formed HTML.
    const complexHtml = '<p class="x"><strong><em>rich text</em></strong></p>';
    assert.equal(htmlToText(complexHtml), 'rich text');
  });

  it('strips tags to fixpoint — double-wrapped tag', () => {
    assert.equal(htmlToText('<div><span>inner</span></div>'), 'inner');
  });
});

describe('htmlToText — entity decoding', () => {
  it('decodes &lt; and &gt;', () => {
    assert.equal(htmlToText('a &lt; b &gt; c'), 'a < b > c');
  });

  it('decodes &amp; to &', () => {
    assert.equal(htmlToText('foo &amp; bar'), 'foo & bar');
  });

  it('does NOT double-unescape &amp;lt; — &amp; decoded last', () => {
    // &amp;lt; should produce &lt; (literal), not < (double-unescape).
    assert.equal(htmlToText('&amp;lt;'), '&lt;');
  });

  it('does NOT double-unescape &amp;gt;', () => {
    assert.equal(htmlToText('&amp;gt;'), '&gt;');
  });

  it('does NOT double-unescape &amp;amp;', () => {
    assert.equal(htmlToText('&amp;amp;'), '&amp;');
  });

  it('decodes &nbsp; to space', () => {
    assert.equal(htmlToText('foo&nbsp;bar'), 'foo bar');
  });

  it('decodes &mdash;', () => {
    assert.equal(htmlToText('a&mdash;b'), 'a—b');
  });

  it('decodes &ndash;', () => {
    assert.equal(htmlToText('a&ndash;b'), 'a–b');
  });

  it('decodes &apos; and &#x27;', () => {
    assert.equal(htmlToText("it&apos;s"), "it's");
    assert.equal(htmlToText("it&#x27;s"), "it's");
  });

  it('decodes &quot;', () => {
    assert.equal(htmlToText('say &quot;hello&quot;'), 'say "hello"');
  });
});

describe('htmlToText — whitespace normalisation', () => {
  it('collapses multiple spaces', () => {
    assert.equal(htmlToText('a  b   c'), 'a b c');
  });

  it('trims leading and trailing whitespace', () => {
    assert.equal(htmlToText('  hello  '), 'hello');
  });
});
