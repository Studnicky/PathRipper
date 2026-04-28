import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateScrapedPage,
  formatScrapedPageErrors,
} from '../../../src/schemas/internal/ScrapedPageSchema.js';
import {
  validateRunManifest,
  formatRunManifestErrors,
} from '../../../src/schemas/internal/RunManifestSchema.js';
import {
  validateTargetDefinition,
} from '../../../src/schemas/internal/TargetDefinitionSchema.js';

describe('ScrapedPage envelope schema', () => {
  it('accepts a fully-formed envelope', () => {
    const ok = validateScrapedPage({
      targetId:  'my-target',
      kind:      'html',
      url:       'https://example.com/x',
      fetchedAt: new Date().toISOString(),
      raw:       { title: 'x' },
    });
    assert.equal(ok, true);
  });

  it('rejects an envelope missing required fields', () => {
    const ok = validateScrapedPage({ targetId: 'x', kind: 'html', url: '' });
    assert.equal(ok, false);
    assert.match(formatScrapedPageErrors(), /required|raw|fetchedAt/);
  });

  it('rejects an unknown kind', () => {
    const ok = validateScrapedPage({
      targetId:  'x',
      kind:      'pdf',
      url:       'https://example.com',
      fetchedAt: new Date().toISOString(),
      raw:       {},
    });
    assert.equal(ok, false);
  });
});

describe('RunManifest schema', () => {
  it('accepts a minimal manifest', () => {
    const ok = validateRunManifest({
      targetId:      'x',
      kind:          'mediawiki',
      runId:         'run-1',
      startedAt:     new Date().toISOString(),
      completedAt:   new Date().toISOString(),
      schemaVersion: '1.0.0',
      count:         0,
      ids:           [],
    });
    if (!ok) console.log(formatRunManifestErrors());
    assert.equal(ok, true);
  });

  it('rejects negative counts', () => {
    const ok = validateRunManifest({
      targetId:      'x',
      kind:          'html',
      runId:         'r',
      startedAt:     new Date().toISOString(),
      completedAt:   new Date().toISOString(),
      schemaVersion: '1.0.0',
      count:         -1,
      ids:           [],
    });
    assert.equal(ok, false);
  });
});

describe('TargetDefinition meta-schema', () => {
  it('accepts a record with no Lane-08 fields (back-compat)', () => {
    const ok = validateTargetDefinition({ baseUrl: 'https://example.com' });
    assert.equal(ok, true);
  });

  it('accepts a record with mapping + outputSchema + onSchemaError', () => {
    const ok = validateTargetDefinition({
      baseUrl:       'https://example.com',
      outputSchema:  './schemas/x.schema.json',
      onSchemaError: 'halt',
      mapping:       { id: '{{ url | hash }}' },
    });
    assert.equal(ok, true);
  });

  it('rejects a bad onSchemaError enum value', () => {
    const ok = validateTargetDefinition({ onSchemaError: 'oops' });
    assert.equal(ok, false);
  });

  it('accepts a target definition with a tasks array', () => {
    const ok = validateTargetDefinition({ tasks: ['./plugin.js'] });
    assert.equal(ok, true);
  });
});
