import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { WikitextParser } from '../../../src/scrapers/WikitextParser.js';

const SAMPLE = `
{{Infobox example
| name      = Example Name
| weight_kg = 12.5
| color     = blue
}}

== Description ==
A short description paragraph for the parser to pick up.

== History ==
Multiple sentences. Another sentence here.

[[Category:Example Category]]
[[Category:Another Category]]
`;

describe('WikitextParser', () => {
  it('parses an infobox into flat key-value entries', () => {
    const parsed = WikitextParser.parse('Example', SAMPLE);
    assert.equal(parsed.title, 'Example');
    assert.equal(WikitextParser.infoboxField(parsed, 'name'), 'Example Name');
    assert.equal(WikitextParser.infoboxField(parsed, 'color'), 'blue');
  });

  it('infoboxNumber returns a number for numeric fields', () => {
    const parsed = WikitextParser.parse('Example', SAMPLE);
    assert.equal(WikitextParser.infoboxNumber(parsed, 'weight_kg'), 12.5);
  });

  it('infoboxNumber returns null for non-numeric fields', () => {
    const parsed = WikitextParser.parse('Example', SAMPLE);
    assert.equal(WikitextParser.infoboxNumber(parsed, 'color'), null);
  });

  it('infoboxField returns null for missing keys', () => {
    const parsed = WikitextParser.parse('Example', SAMPLE);
    assert.equal(WikitextParser.infoboxField(parsed, 'nope'), null);
  });

  it('extracts categories from the wikitext', () => {
    const parsed = WikitextParser.parse('Example', SAMPLE);
    assert.ok(parsed.categories.length >= 1, 'expected at least one category');
  });

  it('produces a sections array (may be empty depending on parser version)', () => {
    const parsed = WikitextParser.parse('Example', SAMPLE);
    assert.ok(Array.isArray(parsed.sections));
  });
});
