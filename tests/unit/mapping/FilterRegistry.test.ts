import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { FilterRegistry } from '../../../src/mapping/FilterRegistry.js';

describe('FilterRegistry', () => {
  afterEach(() => { FilterRegistry.reset(); });

  it('trim removes surrounding whitespace', () => {
    assert.equal(FilterRegistry.apply('trim', '  hello  ', []), 'hello');
  });

  it('lower / upper change case', () => {
    assert.equal(FilterRegistry.apply('lower', 'AbC', []), 'abc');
    assert.equal(FilterRegistry.apply('upper', 'AbC', []), 'ABC');
  });

  it('text strips HTML and collapses whitespace', () => {
    const got = FilterRegistry.apply('text', '<p>hello   <b>world</b></p>', []);
    assert.equal(got, 'hello world');
  });

  it('truncate clips to N chars and appends ellipsis', () => {
    assert.equal(FilterRegistry.apply('truncate', 'abcdef', ['3']), 'abc…');
    assert.equal(FilterRegistry.apply('truncate', 'abc', ['10']), 'abc');
  });

  it('hash produces a deterministic sha256 hex', () => {
    const a = FilterRegistry.apply('hash', 'hello', []);
    const b = FilterRegistry.apply('hash', 'hello', []);
    assert.equal(a, b);
    assert.match(String(a), /^[a-f0-9]{64}$/);
  });

  it('join concatenates an array with the given separator', () => {
    assert.equal(FilterRegistry.apply('join', ['a', 'b', 'c'], [' / ']), 'a / b / c');
  });

  it('default replaces null / undefined / empty strings', () => {
    assert.equal(FilterRegistry.apply('default', null, ['fallback']), 'fallback');
    assert.equal(FilterRegistry.apply('default', '', ['x']), 'x');
    assert.equal(FilterRegistry.apply('default', 'real', ['x']), 'real');
  });

  it('throws on unknown filters', () => {
    assert.throws(() => FilterRegistry.apply('nope', 'x', []), /Unknown filter/);
  });

  it('register adds a custom filter and apply uses it', () => {
    FilterRegistry.register('exclaim', (v) => `${String(v)}!`);
    assert.equal(FilterRegistry.apply('exclaim', 'wow', []), 'wow!');
  });

  it('refuses to override built-ins', () => {
    assert.throws(() => FilterRegistry.register('trim', (v) => v), /Cannot override built-in/);
  });
});
