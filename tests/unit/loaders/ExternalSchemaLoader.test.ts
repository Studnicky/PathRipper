import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ExternalSchemaLoader } from '../../../src/loaders/ExternalSchemaLoader.js';

let tmpDir = '';

const SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name'],
  properties: {
    id:   { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
  },
};

describe('ExternalSchemaLoader', () => {
  before(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'ripperoni-ext-')); });
  after(async  () => { await rm(tmpDir, { recursive: true, force: true }); });
  beforeEach(() => { ExternalSchemaLoader.reset(); });

  it('loads a schema from a relative file path and validates against it', async () => {
    const path = join(tmpDir, 'page.schema.json');
    await writeFile(path, JSON.stringify(SCHEMA));

    const compiled = await ExternalSchemaLoader.load(path, tmpDir);
    assert.equal(compiled.validate({ id: 'a', name: 'n' }), true);
    assert.equal(compiled.validate({ id: 'a' }), false);
    assert.match(compiled.format(compiled.validate.errors), /name/);
  });

  it('caches compiled validators by canonical key', async () => {
    const path = join(tmpDir, 'cache.schema.json');
    await writeFile(path, JSON.stringify(SCHEMA));

    const a = await ExternalSchemaLoader.load(path, tmpDir);
    const b = await ExternalSchemaLoader.load(path, tmpDir);
    assert.equal(a.validate, b.validate, 'expected the same compiled validator instance');
  });

  it('throws on a missing file with the canonical key in the error', async () => {
    await assert.rejects(
      ExternalSchemaLoader.load('does-not-exist.schema.json', tmpDir),
      /does-not-exist\.schema\.json/,
    );
  });
});
