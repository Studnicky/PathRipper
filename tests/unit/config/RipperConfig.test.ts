import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RipperConfig } from '../../../src/config/RipperConfig.js';

let tmpDir = '';

async function writeFixture(name: string, body: unknown): Promise<string> {
  const path = join(tmpDir, name);
  await writeFile(path, typeof body === 'string' ? body : JSON.stringify(body));
  return path;
}

describe('RipperConfig.load()', () => {
  before(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'ripperoni-cfg-')); });
  after(async  () => { await rm(tmpDir, { recursive: true, force: true }); });

  it('loads a minimal valid config', async () => {
    const path = await writeFixture('valid.json', { output: { basePath: './out' } });
    const cfg = await RipperConfig.load(path);
    assert.equal(cfg.output.basePath, './out');
  });

  it('loads a full valid config with all sections', async () => {
    const path = await writeFixture('full.json', {
      output: { basePath: './out', format: 'json', pretty: true },
      targets: { foo: { baseUrl: 'https://example.com', rateLimitMs: 100 } },
      mediawiki: { bar: { apiUrl: 'https://wiki.example/w/api.php' } },
      crawlers: { baz: { startUrls: ['https://example.com/x', 'https://example.com/y'], domain: 'example', target: 'id', delimiter: 'cat', jitterMs: 25, maxPages: 100 } },
    });
    const cfg = await RipperConfig.load(path);
    assert.equal(cfg.targets?.foo?.baseUrl, 'https://example.com');

    assert.equal(cfg.crawlers?.baz?.delimiter, 'cat');
    assert.equal(cfg.crawlers?.baz?.startUrls.length, 2);
    assert.equal(cfg.crawlers?.baz?.maxPages, 100);
  });

  it('throws on missing required field with the field path in the message', async () => {
    const path = await writeFixture('missing.json', { output: {} });
    await assert.rejects(RipperConfig.load(path), /basePath/);
  });

  it('throws on additional unexpected property', async () => {
    const path = await writeFixture('extra.json', { output: { basePath: './out' }, mystery: 1 });
    await assert.rejects(RipperConfig.load(path), /must NOT have additional/);
  });

  it('throws on a malformed URI', async () => {
    const path = await writeFixture('badurl.json', {
      output: { basePath: './out' },
      mediawiki: { x: { apiUrl: 'not-a-url', userAgent: 'X' } },
    });
    await assert.rejects(RipperConfig.load(path), /uri/);
  });

  it('throws on missing file with the path in the error', async () => {
    await assert.rejects(RipperConfig.load(join(tmpDir, 'nope.json')), /nope\.json/);
  });

  it('defaults() returns a valid config', () => {
    const d = RipperConfig.defaults();
    assert.equal(d.output.basePath, './output');
  });
});
