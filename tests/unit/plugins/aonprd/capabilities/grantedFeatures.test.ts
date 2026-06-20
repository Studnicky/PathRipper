// Test suite for grantedFeatures capability helper.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseGrantedFeatures } from '../../../../../plugins/aonprd/capabilities/grantedFeatures.js';
import type { Section } from '../../../../../plugins/aonprd/capabilities/strategy.js';

describe('parseGrantedFeatures', () => {
  it('extracts h2 sections as granted features', () => {
    const sections: Section[] = [
      {
        heading: 'Heritage Bonus',
        level: 2,
        body_text: 'A bonus to a core ancestry trait.',
        body_html: '<p>A bonus to a core ancestry trait.</p>',
        links: [],
      },
      {
        heading: 'Ancestral Fortitude',
        level: 2,
        body_text: 'Increased resilience against hardship.',
        body_html: '<p>Increased resilience against hardship.</p>',
        links: [],
      },
    ];

    const result = parseGrantedFeatures(sections);

    assert.equal(result.length, 2);
    assert.deepEqual(result[0], {
      name: 'Heritage Bonus',
      description: 'A bonus to a core ancestry trait.',
    });
    assert.deepEqual(result[1], {
      name: 'Ancestral Fortitude',
      description: 'Increased resilience against hardship.',
    });
  });

  it('filters out sections with empty body text', () => {
    const sections: Section[] = [
      {
        heading: 'Feature One',
        level: 2,
        body_text: 'Has body.',
        body_html: '<p>Has body.</p>',
        links: [],
      },
      {
        heading: 'Feature Two',
        level: 2,
        body_text: '   ',
        body_html: '   ',
        links: [],
      },
    ];

    const result = parseGrantedFeatures(sections);

    assert.equal(result.length, 1);
    assert.equal(result[0]!.name, 'Feature One');
  });

  it('respects level filter (defaults to h2 only)', () => {
    const sections: Section[] = [
      {
        heading: 'H2 Feature',
        level: 2,
        body_text: 'Body for h2.',
        body_html: '<p>Body for h2.</p>',
        links: [],
      },
      {
        heading: 'H3 Feature',
        level: 3,
        body_text: 'Body for h3.',
        body_html: '<p>Body for h3.</p>',
        links: [],
      },
    ];

    const result = parseGrantedFeatures(sections);

    assert.equal(result.length, 1);
    assert.equal(result[0]!.name, 'H2 Feature');
  });

  it('excludes sections by label (case-insensitive)', () => {
    const sections: Section[] = [
      {
        heading: 'Source',
        level: 2,
        body_text: 'Book reference.',
        body_html: '<p>Book reference.</p>',
        links: [],
      },
      {
        heading: 'Features',
        level: 2,
        body_text: 'Feature content.',
        body_html: '<p>Feature content.</p>',
        links: [],
      },
    ];

    const result = parseGrantedFeatures(sections, { excludeLabels: ['source', 'other'] });

    assert.equal(result.length, 1);
    assert.equal(result[0]!.name, 'Features');
  });

  it('supports custom heading predicate', () => {
    const sections: Section[] = [
      {
        heading: 'Normal Feature',
        level: 2,
        body_text: 'Regular content.',
        body_html: '<p>Regular content.</p>',
        links: [],
      },
      {
        heading: 'Special-Feature',
        level: 2,
        body_text: 'Special content.',
        body_html: '<p>Special content.</p>',
        links: [],
      },
    ];

    const result = parseGrantedFeatures(sections, {
      predicate: (sec) => sec.heading.includes('Special'),
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]!.name, 'Special-Feature');
  });
});
