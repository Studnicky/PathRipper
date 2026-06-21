import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ScraperCache } from '../../../src/modules/cache/ScraperCache.js';
import type { CacheMetaType } from '../../../src/types/ScraperCache.js';

type InputMetaType = Omit<CacheMetaType, 'bodyPath' | 'size'>;

const makeMeta = (overrides: Partial<InputMetaType> = {}): InputMetaType => ({
  url:       'https://example.com/page',
  method:    'GET',
  fetchedAt: new Date().toISOString(),
  status:    200,
  ...overrides,
});

const makeTmpDir = async (): Promise<string> => {
  return mkdtemp(join(tmpdir(), 'scraper-cache-'));
};

describe('ScraperCache', () => {
  describe('keyFor', () => {
    it('is deterministic for identical input', () => {
      const keyA = ScraperCache.keyFor({ method: 'GET', url: 'https://example.com/x' });
      const keyB = ScraperCache.keyFor({ method: 'GET', url: 'https://example.com/x' });
      assert.equal(keyA, keyB);
      assert.equal(keyA.length, 40);
    });

    it('is order-independent for headers', () => {
      const keyA = ScraperCache.keyFor({
        method:  'GET',
        url:     'https://example.com/x',
        headers: { 'X-A': '1', 'X-B': '2' },
      });
      const keyB = ScraperCache.keyFor({
        method:  'GET',
        url:     'https://example.com/x',
        headers: { 'X-B': '2', 'X-A': '1' },
      });
      assert.equal(keyA, keyB);
    });

    it('differs for different methods', () => {
      const keyA = ScraperCache.keyFor({ method: 'GET',  url: 'https://example.com/x' });
      const keyB = ScraperCache.keyFor({ method: 'POST', url: 'https://example.com/x' });
      assert.notEqual(keyA, keyB);
    });

    it('differs for different urls', () => {
      const keyA = ScraperCache.keyFor({ method: 'GET', url: 'https://example.com/a' });
      const keyB = ScraperCache.keyFor({ method: 'GET', url: 'https://example.com/b' });
      assert.notEqual(keyA, keyB);
    });

    it('differs for different header values', () => {
      const keyA = ScraperCache.keyFor({
        method:  'GET',
        url:     'https://example.com/x',
        headers: { 'X-A': '1' },
      });
      const keyB = ScraperCache.keyFor({
        method:  'GET',
        url:     'https://example.com/x',
        headers: { 'X-A': '2' },
      });
      assert.notEqual(keyA, keyB);
    });
  });

  describe('miss behavior', () => {
    it('has() returns false on miss', async () => {
      const dir = await makeTmpDir();
      try {
        const cache = ScraperCache.create({ dir, mode: 'read-write' });
        const key = ScraperCache.keyFor({ method: 'GET', url: 'https://example.com/missing' });
        assert.equal(await cache.has(key), false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('read() returns null on miss', async () => {
      const dir = await makeTmpDir();
      try {
        const cache = ScraperCache.create({ dir, mode: 'read-write' });
        const key = ScraperCache.keyFor({ method: 'GET', url: 'https://example.com/missing' });
        assert.equal(await cache.read(key), null);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('write/read round-trip', () => {
    it('read() after write() returns the same body and meta', async () => {
      const dir = await makeTmpDir();
      try {
        const cache = ScraperCache.create({ dir, mode: 'read-write' });
        const key = ScraperCache.keyFor({ method: 'GET', url: 'https://example.com/page' });
        const meta = makeMeta();
        await cache.write(key, '<html>hi</html>', meta);
        assert.equal(await cache.has(key), true);
        const entry = await cache.read(key);
        assert.notEqual(entry, null);
        assert.equal(entry?.body, '<html>hi</html>');
        // write() enriches meta with bodyPath + size — compare only the fields we supplied
        assert.equal(entry?.meta.url,       meta.url);
        assert.equal(entry?.meta.method,    meta.method);
        assert.equal(entry?.meta.status,    meta.status);
        assert.equal(typeof entry?.meta.bodyPath, 'string');
        assert.ok((entry?.meta.size ?? -1) >= 0);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('write() creates the shard subdirectory as needed', async () => {
      const dir = await makeTmpDir();
      try {
        const cache = ScraperCache.create({ dir, mode: 'read-write' });
        const key = ScraperCache.keyFor({ method: 'GET', url: 'https://example.com/shard' });
        await cache.write(key, 'body', makeMeta());
        const shard = key.slice(0, 2);
        const shardStat = await stat(join(dir, shard));
        assert.equal(shardStat.isDirectory(), true);
        // body files live under <dir>/bodies/<shard>/, meta files under <dir>/<shard>/
        const metaFiles = await readdir(join(dir, shard));
        const bodyFiles = await readdir(join(dir, 'bodies', shard)).catch((): string[] => []);
        const rest = key.slice(2);
        assert.equal(metaFiles.includes(`${rest}.meta.json`), true);
        assert.equal(bodyFiles.includes(`${rest}.body`),       true);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('mode read-only', () => {
    it('rejects writes (no-op)', async () => {
      const dir = await makeTmpDir();
      try {
        const cache = ScraperCache.create({ dir, mode: 'read-only' });
        const key = ScraperCache.keyFor({ method: 'GET', url: 'https://example.com/ro' });
        await cache.write(key, 'body', makeMeta());
        assert.equal(await cache.has(key), false);
        assert.equal(await cache.read(key), null);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('mode write-only', () => {
    it('rejects reads even when entry exists on disk', async () => {
      const dir = await makeTmpDir();
      try {
        const writer = ScraperCache.create({ dir, mode: 'read-write' });
        const key = ScraperCache.keyFor({ method: 'GET', url: 'https://example.com/wo' });
        await writer.write(key, 'body', makeMeta());

        const reader = ScraperCache.create({ dir, mode: 'write-only' });
        assert.equal(await reader.has(key),  false);
        assert.equal(await reader.read(key), null);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('mode off', () => {
    it('rejects both reads and writes', async () => {
      const dir = await makeTmpDir();
      try {
        const cache = ScraperCache.create({ dir, mode: 'off' });
        const key = ScraperCache.keyFor({ method: 'GET', url: 'https://example.com/off' });
        await cache.write(key, 'body', makeMeta());
        assert.equal(await cache.has(key),  false);
        assert.equal(await cache.read(key), null);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('ttlMs', () => {
    it('invalidates stale entries on read', async () => {
      const dir = await makeTmpDir();
      try {
        const cache = ScraperCache.create({ dir, mode: 'read-write', ttlMs: 50 });
        const key = ScraperCache.keyFor({ method: 'GET', url: 'https://example.com/ttl' });
        const stale = makeMeta({ fetchedAt: new Date(Date.now() - 10_000).toISOString() });
        await cache.write(key, 'old', stale);
        assert.equal(await cache.read(key), null);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('invalidates stale entries on has()', async () => {
      const dir = await makeTmpDir();
      try {
        const cache = ScraperCache.create({ dir, mode: 'read-write', ttlMs: 50 });
        const key = ScraperCache.keyFor({ method: 'GET', url: 'https://example.com/ttl-has' });
        const stale = makeMeta({ fetchedAt: new Date(Date.now() - 10_000).toISOString() });
        await cache.write(key, 'old', stale);
        assert.equal(await cache.has(key), false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('serves entries within ttl', async () => {
      const dir = await makeTmpDir();
      try {
        const cache = ScraperCache.create({ dir, mode: 'read-write', ttlMs: 60_000 });
        const key = ScraperCache.keyFor({ method: 'GET', url: 'https://example.com/ttl-fresh' });
        await cache.write(key, 'fresh', makeMeta());
        assert.equal(await cache.has(key), true);
        const entry = await cache.read(key);
        assert.equal(entry?.body, 'fresh');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('delete', () => {
    it('removes both .body and .meta.json', async () => {
      const dir = await makeTmpDir();
      try {
        const cache = ScraperCache.create({ dir, mode: 'read-write' });
        const key = ScraperCache.keyFor({ method: 'GET', url: 'https://example.com/del' });
        await cache.write(key, 'body', makeMeta());
        await cache.delete(key);
        assert.equal(await cache.has(key),  false);
        assert.equal(await cache.read(key), null);

        const shard = key.slice(0, 2);
        const files: string[] = await readdir(join(dir, shard)).catch((): string[] => []);
        assert.equal(files.includes(`${key.slice(2)}.body`),      false);
        assert.equal(files.includes(`${key.slice(2)}.meta.json`), false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('on missing key is a no-op (no throw)', async () => {
      const dir = await makeTmpDir();
      try {
        const cache = ScraperCache.create({ dir, mode: 'read-write' });
        const key = ScraperCache.keyFor({ method: 'GET', url: 'https://example.com/never' });
        await cache.delete(key);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('on partial-presence (only meta) is a no-op', async () => {
      const dir = await makeTmpDir();
      try {
        const cache = ScraperCache.create({ dir, mode: 'read-write' });
        const key = ScraperCache.keyFor({ method: 'GET', url: 'https://example.com/partial' });
        const shardDir = join(dir, key.slice(0, 2));
        await (await import('node:fs/promises')).mkdir(shardDir, { recursive: true });
        await writeFile(join(shardDir, `${key.slice(2)}.meta.json`), JSON.stringify(makeMeta()), 'utf8');
        await cache.delete(key);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
