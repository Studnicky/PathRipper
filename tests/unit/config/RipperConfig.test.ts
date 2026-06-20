import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RipperConfig, RAW_CACHE_OFF_ERROR } from '../../../src/config/RipperConfig.js';
import { RipperConfigError } from '../../../src/errors/RipperConfigError.js';

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
      targets: { foo: { baseUrl: 'https://example.com', rateLimitMs: 100, pipeline: ['./plugins/foo/parse.task.js'] } },
      mediawiki: { bar: { apiUrl: 'https://wiki.example/w/api.php', pipeline: ["./plugins/foo/parse.task.js"] } },
      crawlers: { baz: { startUrls: ['https://example.com/x', 'https://example.com/y'], domain: 'example', target: 'id', delimiter: 'cat', jitterMs: 25, maxPages: 100 } },
    });
    const cfg = await RipperConfig.load(path);
    assert.equal(cfg.targets?.foo?.baseUrl, 'https://example.com');
    assert.deepEqual(cfg.mediawiki?.bar?.pipeline, ['./plugins/foo/parse.task.js']);
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
    const defaults = RipperConfig.defaults();
    assert.equal(defaults.output.basePath, './output');
  });

  // ── Cache default-on ────────────────────────────────────────────────────────

  describe('cache default-on (targets)', () => {
    it('target with no cache block gets default cache dir and read-write mode', async () => {
      const path = await writeFixture('no-cache-target.json', {
        output: { basePath: './out' },
        targets: {
          mywiki: {
            baseUrl:  'https://example.com',
            pipeline: ['html:fetch', 'json:write'],
          },
        },
      });
      const cfg = await RipperConfig.load(path);
      const cache = cfg.targets?.['mywiki']?.cache;
      assert.equal(cache?.dir, 'output/.cache/mywiki');
      assert.equal(cache?.mode, 'read-write');
    });

    it('target with explicit cache block retains explicit values', async () => {
      const path = await writeFixture('explicit-cache-target.json', {
        output: { basePath: './out' },
        targets: {
          mywiki: {
            baseUrl:  'https://example.com',
            pipeline: ['html:fetch', 'json:write'],
            cache:    { dir: 'custom/dir', mode: 'read-only' },
          },
        },
      });
      const cfg = await RipperConfig.load(path);
      const cache = cfg.targets?.['mywiki']?.cache;
      assert.equal(cache?.dir, 'custom/dir');
      assert.equal(cache?.mode, 'read-only');
    });

    it('target with cache.mode off and includeRawContent true (default) throws RipperConfigError', async () => {
      const path = await writeFixture('cache-off-raw-on-target.json', {
        output: { basePath: './out' },
        targets: {
          mywiki: {
            baseUrl:  'https://example.com',
            pipeline: ['html:fetch', 'json:write'],
            cache:    { dir: '.cache', mode: 'off' },
            // includeRawContent absent → defaults to true
          },
        },
      });
      await assert.rejects(
        RipperConfig.load(path),
        (err: unknown) => {
          assert.ok(err instanceof RipperConfigError, `Expected RipperConfigError, got ${String(err)}`);
          assert.ok(
            err.message.includes(RAW_CACHE_OFF_ERROR),
            `Expected error message to contain invariant text, got: ${err.message}`,
          );
          return true;
        },
      );
    });

    it('target with cache.mode off and includeRawContent false loads successfully', async () => {
      const path = await writeFixture('cache-off-raw-off-target.json', {
        output: { basePath: './out' },
        targets: {
          mywiki: {
            baseUrl:           'https://example.com',
            pipeline:          ['html:fetch', 'json:write'],
            cache:             { dir: '.cache', mode: 'off' },
            includeRawContent: false,
          },
        },
      });
      const cfg = await RipperConfig.load(path);
      assert.equal(cfg.targets?.['mywiki']?.cache.mode, 'off');
      assert.equal(cfg.targets?.['mywiki']?.includeRawContent, false);
    });

    it('target with cache.mode off and explicit includeRawContent true throws RipperConfigError', async () => {
      const path = await writeFixture('cache-off-raw-explicit-on-target.json', {
        output: { basePath: './out' },
        targets: {
          mywiki: {
            baseUrl:           'https://example.com',
            pipeline:          ['html:fetch', 'json:write'],
            cache:             { dir: '.cache', mode: 'off' },
            includeRawContent: true,
          },
        },
      });
      await assert.rejects(
        RipperConfig.load(path),
        (err: unknown) => {
          assert.ok(err instanceof RipperConfigError);
          assert.ok(err.message.includes(RAW_CACHE_OFF_ERROR));
          return true;
        },
      );
    });
  });

  // ── Cache default-on (mediawiki) ────────────────────────────────────────────

  describe('cache default-on (mediawiki)', () => {
    it('mediawiki target with no cache block gets default cache dir and read-write mode', async () => {
      const path = await writeFixture('no-cache-mediawiki.json', {
        output: { basePath: './out' },
        mediawiki: {
          bulbapedia: {
            apiUrl:   'https://bulbapedia.bulbagarden.net/w/api.php',
            pipeline: ['wiki:fetch', 'json:write'],
          },
        },
      });
      const cfg = await RipperConfig.load(path);
      const cache = cfg.mediawiki?.['bulbapedia']?.cache;
      assert.equal(cache?.dir, 'output/.cache/bulbapedia');
      assert.equal(cache?.mode, 'read-write');
    });

    it('mediawiki target with explicit cache block retains explicit values', async () => {
      const path = await writeFixture('explicit-cache-mediawiki.json', {
        output: { basePath: './out' },
        mediawiki: {
          bulbapedia: {
            apiUrl:   'https://bulbapedia.bulbagarden.net/w/api.php',
            pipeline: ['wiki:fetch', 'json:write'],
            cache:    { dir: 'wiki/cache', mode: 'write-only', ttlMs: 3600000 },
          },
        },
      });
      const cfg = await RipperConfig.load(path);
      const cache = cfg.mediawiki?.['bulbapedia']?.cache;
      assert.equal(cache?.dir, 'wiki/cache');
      assert.equal(cache?.mode, 'write-only');
      assert.equal(cache?.ttlMs, 3600000);
    });

    it('mediawiki target with cache.mode off and includeRawContent true (default) throws RipperConfigError', async () => {
      const path = await writeFixture('cache-off-raw-on-mediawiki.json', {
        output: { basePath: './out' },
        mediawiki: {
          bulbapedia: {
            apiUrl:   'https://bulbapedia.bulbagarden.net/w/api.php',
            pipeline: ['wiki:fetch', 'json:write'],
            cache:    { dir: '.cache', mode: 'off' },
          },
        },
      });
      await assert.rejects(
        RipperConfig.load(path),
        (err: unknown) => {
          assert.ok(err instanceof RipperConfigError);
          assert.ok(err.message.includes(RAW_CACHE_OFF_ERROR));
          assert.ok(err.message.includes('mediawiki.bulbapedia'));
          return true;
        },
      );
    });

    it('mediawiki target with cache.mode off and includeRawContent false loads successfully', async () => {
      const path = await writeFixture('cache-off-raw-off-mediawiki.json', {
        output: { basePath: './out' },
        mediawiki: {
          bulbapedia: {
            apiUrl:            'https://bulbapedia.bulbagarden.net/w/api.php',
            pipeline:          ['wiki:fetch', 'json:write'],
            cache:             { dir: '.cache', mode: 'off' },
            includeRawContent: false,
          },
        },
      });
      const cfg = await RipperConfig.load(path);
      assert.equal(cfg.mediawiki?.['bulbapedia']?.cache.mode, 'off');
      assert.equal(cfg.mediawiki?.['bulbapedia']?.includeRawContent, false);
    });
  });
});
