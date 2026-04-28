import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MappingEngine } from '../../../src/mapping/MappingEngine.js';

describe('MappingEngine', () => {
  it('projects raw fields directly when no filters are given', () => {
    const engine = MappingEngine.compile({
      title: '{{ title }}',
      count: '{{ count }}',
    });
    const out = engine.project({ title: 'hello', count: 7 });
    assert.deepEqual(out, { title: 'hello', count: 7 });
  });

  it('applies a chain of filters in order', () => {
    const engine = MappingEngine.compile({
      summary: '{{ body | text | truncate:5 }}',
    });
    const out = engine.project({ body: '<p>hello world</p>' });
    assert.equal(out.summary, 'hello…');
  });

  it('hashes a URL into a stable id', () => {
    const engine = MappingEngine.compile({ id: '{{ url | hash }}' });
    const a = engine.project({ url: 'https://example.com/a' });
    const b = engine.project({ url: 'https://example.com/a' });
    assert.equal(a.id, b.id);
    assert.match(String(a.id), /^[a-f0-9]{64}$/);
  });

  it('joins arrays with the default separator when no arg is given', () => {
    const engine = MappingEngine.compile({ tags: '{{ tags | join }}' });
    const out = engine.project({ tags: ['a', 'b', 'c'] });
    assert.equal(out.tags, 'a,b,c');
  });

  it('joins arrays with a custom separator argument', () => {
    const engine = MappingEngine.compile({ tags: '{{ tags | join:- }}' });
    const out = engine.project({ tags: ['a', 'b', 'c'] });
    assert.equal(out.tags, 'a-b-c');
  });

  it('default filter handles missing or null fields', () => {
    const engine = MappingEngine.compile({ slug: '{{ slug | default:no-slug }}' });
    const a = engine.project({});
    const b = engine.project({ slug: null });
    const c = engine.project({ slug: 'abc' });
    assert.equal(a.slug, 'no-slug');
    assert.equal(b.slug, 'no-slug');
    assert.equal(c.slug, 'abc');
  });

  it('throws on a malformed template at compile time', () => {
    assert.throws(() => MappingEngine.compile({ x: 'not-a-template' }), /must match/);
  });
});
