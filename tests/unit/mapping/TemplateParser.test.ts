import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { TemplateParser } from '../../../src/mapping/TemplateParser.js';

describe('TemplateParser', () => {
  it('parses a bare field reference', () => {
    const t = TemplateParser.parse('{{ name }}');
    assert.equal(t.field, 'name');
    assert.deepEqual(t.filters, []);
  });

  it('parses a single filter without args', () => {
    const t = TemplateParser.parse('{{ name | trim }}');
    assert.equal(t.field, 'name');
    assert.deepEqual(t.filters, [{ name: 'trim', args: [] }]);
  });

  it('parses chained filters and a colon arg', () => {
    const t = TemplateParser.parse('{{ body | text | truncate:280 }}');
    assert.equal(t.field, 'body');
    assert.deepEqual(t.filters, [
      { name: 'text',     args: [] },
      { name: 'truncate', args: ['280'] },
    ]);
  });

  it('parses comma-separated args', () => {
    const t = TemplateParser.parse('{{ tags | join:|, }}');
    assert.equal(t.field, 'tags');
    assert.equal(t.filters[0]?.name, 'join');
  });

  it('rejects strings that are not templates', () => {
    assert.throws(() => TemplateParser.parse('not a template'), /must match/);
  });

  it('rejects empty templates', () => {
    assert.throws(() => TemplateParser.parse('{{ }}'), /no field|must match/);
  });
});
