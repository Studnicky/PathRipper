import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { Logger } from '../logger/logger.js';
import type {
  CacheEntryInterface,
  CacheKeyRequestInterface,
  CacheMetaInterface,
  ScraperCacheConfigInterface,
} from '../../types/ScraperCache.js';

export type {
  CacheEntryInterface,
  CacheKeyRequestInterface,
  CacheMetaInterface,
  ScraperCacheConfigInterface,
};

/**
 * Returns true when an unknown error value carries an ENOENT filesystem code.
 *
 * @param error - Any caught value.
 * @returns Whether the error is a benign "file not found".
 */
const isEnoent = (error: unknown): boolean => {
  return typeof error === 'object'
      && error !== null
      && 'code' in error
      && (error as { code?: unknown }).code === 'ENOENT';
};

/** Pointer-store cache: meta JSON files index body files that may live anywhere on disk. */
const META_SUFFIX = '.meta.json';

/**
 * Sharded, content-addressed pointer cache for scraper bodies and metadata.
 *
 * @remarks
 * The cache stores only `.meta.json` index files at
 * `<dir>/<key.slice(0,2)>/<key.slice(2)>.meta.json`. Each meta entry's
 * `bodyPath` field points at the body's location on disk (default
 * `<bodyDir>/<shard>/<rest>.body`, but may live in any user-owned directory).
 * Mode (`read-write`/`read-only`/`write-only`/`off`) and optional `ttlMs`
 * gate read/write access; when `maxEntries` is set, writes evict the oldest
 * entries by `fetchedAt`.
 *
 * @example
 * ```ts
 * const cache = ScraperCache.create({ dir: './.cache', mode: 'read-write', maxEntries: 100 });
 * const key   = ScraperCache.keyFor({ method: 'GET', url });
 * const hit   = await cache.read(key);
 * if (hit === null) await cache.write(key, body, { url, method: 'GET', status: 200, fetchedAt: new Date().toISOString() });
 * ```
 *
 * @category Cache
 * @since 2.0.0
 * @see {@link ScraperCacheConfigInterface}
 * @group Core
 */
export class ScraperCache {
  readonly #config:  ScraperCacheConfigInterface;
  readonly #log:     Logger;
  readonly #bodyDir: string;

  /**
   * @param config - Cache configuration including dir, mode, optional ttlMs, optional maxEntries, optional bodyDir.
   */
  private constructor(config: ScraperCacheConfigInterface) {
    this.#config  = config;
    this.#log     = Logger.forComponent('ScraperCache');
    this.#bodyDir = config.bodyDir !== undefined ? resolve(config.bodyDir) : resolve(config.dir, 'bodies');
  }

  /**
   * Creates a ScraperCache instance.
   *
   * @param config - Cache configuration.
   * @returns A new ScraperCache.
   */
  public static create(config: ScraperCacheConfigInterface): ScraperCache {
    return new ScraperCache(config);
  }

  /**
   * Computes a stable sha1 hex cache key from a method/url/headers tuple.
   *
   * @param req - Request shape; headers are sorted alphabetically before hashing.
   * @returns 40-character lowercase hex sha1 digest.
   */
  public static keyFor(req: CacheKeyRequestInterface): string {
    const sortedHeaders = ScraperCache.sortHeaders(req.headers);
    const input = `${req.method}\n${req.url}\n${JSON.stringify(sortedHeaders)}`;
    return createHash('sha1').update(input).digest('hex');
  }

  /** Returns the configured (or default) body directory all cache-managed body files live under. */
  public getBodyDir(): string {
    return this.#bodyDir;
  }

  /** Returns the cache mode supplied at creation. */
  public getMode(): ScraperCacheConfigInterface['mode'] {
    return this.#config.mode;
  }

  /**
   * Returns true if the entry exists, is not stale, and the mode permits reads.
   *
   * @param key - Cache key from `keyFor`.
   * @returns Whether the cache currently holds a usable entry for the key.
   */
  public async has(key: string): Promise<boolean> {
    if (!this.readsAllowed()) return false;
    try {
      const meta = await this.readMeta(key);
      if (meta === null)            return false;
      if (this.isStale(meta))       return false;
      await stat(meta.bodyPath);
      return true;
    } catch (error) {
      if (isEnoent(error)) return false;
      throw error;
    }
  }

  /**
   * Reads a cache entry, returning null on miss, stale entries, missing bodies, or disallowed modes.
   *
   * @param key - Cache key from `keyFor`.
   * @returns The cached body and meta, or null on miss/stale/mode-blocked.
   */
  public async read(key: string): Promise<CacheEntryInterface | null> {
    if (!this.readsAllowed()) return null;
    const meta = await this.readMeta(key);
    if (meta === null)      return null;
    if (this.isStale(meta)) return null;
    try {
      const body = await readFile(meta.bodyPath, 'utf8');
      this.#log.debug('read', 'cache hit', { key, url: meta.url });
      return { body, meta };
    } catch (error) {
      if (isEnoent(error)) {
        this.#log.warn('read', 'orphaned meta — body missing; dropping entry', { key, bodyPath: meta.bodyPath });
        await ScraperCache.removeQuiet(this.metaPath(key));
        return null;
      }
      throw error;
    }
  }

  /**
   * Writes a body + meta entry to the cache; no-op when mode is `read-only` or `off`.
   *
   * @remarks
   * If `meta.bodyPath` is set, the cache uses that absolute path verbatim
   * (writing the body there only when the file does not already exist). When
   * `meta.bodyPath` is unset, the cache writes under `bodyDir`. The persisted
   * meta entry always carries an absolute `bodyPath` plus the body's `size`.
   *
   * @param key - Cache key from `keyFor`.
   * @param body - Response body to persist.
   * @param meta - Sidecar metadata; `bodyPath` and `size` may be omitted (they will be filled in).
   */
  public async write(
    key: string,
    body: string,
    meta: Omit<CacheMetaInterface, 'bodyPath' | 'size'> & { bodyPath?: string; size?: number },
  ): Promise<void> {
    if (!this.writesAllowed()) return;

    const explicitBodyPath = meta.bodyPath !== undefined && meta.bodyPath.length > 0;
    const bodyPath = explicitBodyPath ? resolve(meta.bodyPath as string) : this.defaultBodyPath(key);

    await mkdir(dirname(bodyPath), { recursive: true });
    if (!explicitBodyPath || !(await ScraperCache.exists(bodyPath))) {
      await writeFile(bodyPath, body, 'utf8');
    }

    const finalMeta: CacheMetaInterface = {
      url:       meta.url,
      method:    meta.method,
      fetchedAt: meta.fetchedAt,
      status:    meta.status,
      bodyPath,
      size:      Buffer.byteLength(body, 'utf8'),
      ...(meta.headers !== undefined ? { headers: meta.headers } : {}),
    };

    const metaPath = this.metaPath(key);
    await mkdir(dirname(metaPath), { recursive: true });
    await writeFile(metaPath, JSON.stringify(finalMeta), 'utf8');

    if (this.#config.maxEntries !== undefined) {
      await this.evictLruIfNeeded(this.#config.maxEntries, key);
    }
  }

  /**
   * Removes the meta entry for a key; deletes the body file too when it lives under `bodyDir`.
   *
   * @param key - Cache key from `keyFor`.
   */
  public async delete(key: string): Promise<void> {
    const meta = await this.readMeta(key);
    if (meta !== null && meta.bodyPath !== undefined && this.isUnderBodyDir(meta.bodyPath)) {
      await ScraperCache.removeQuiet(meta.bodyPath);
    }
    await ScraperCache.removeQuiet(this.metaPath(key));
  }

  private readsAllowed(): boolean {
    const mode = this.#config.mode;
    return mode === 'read-write' || mode === 'read-only';
  }

  private writesAllowed(): boolean {
    const mode = this.#config.mode;
    return mode === 'read-write' || mode === 'write-only';
  }

  private isStale(meta: CacheMetaInterface): boolean {
    const ttl = this.#config.ttlMs;
    if (ttl === undefined) return false;
    const age = Date.now() - new Date(meta.fetchedAt).valueOf();
    return age > ttl;
  }

  private async readMeta(key: string): Promise<CacheMetaInterface | null> {
    try {
      const raw = await readFile(this.metaPath(key), 'utf8');
      return JSON.parse(raw) as CacheMetaInterface;
    } catch (error) {
      if (isEnoent(error)) return null;
      throw error;
    }
  }

  private metaPath(key: string): string {
    return join(this.#config.dir, key.slice(0, 2), `${key.slice(2)}${META_SUFFIX}`);
  }

  private defaultBodyPath(key: string): string {
    return join(this.#bodyDir, key.slice(0, 2), `${key.slice(2)}.body`);
  }

  private isUnderBodyDir(bodyPath: string): boolean {
    const abs = isAbsolute(bodyPath) ? bodyPath : resolve(bodyPath);
    const rel = relative(this.#bodyDir, abs);
    return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
  }

  /** Walks the meta dir, sorts entries by `fetchedAt`, evicts oldest until count ≤ maxEntries. */
  private async evictLruIfNeeded(maxEntries: number, currentKey: string): Promise<void> {
    const entries = await this.collectMetaEntries();
    if (entries.length <= maxEntries) return;

    entries.sort((a, b): number => Date.parse(a.meta.fetchedAt) - Date.parse(b.meta.fetchedAt));
    const evictCount = entries.length - maxEntries;

    for (let i = 0; i < evictCount; i++) {
      const entry = entries[i];
      if (entry === undefined) continue;
      if (entry.key === currentKey) continue;
      if (this.isUnderBodyDir(entry.meta.bodyPath)) {
        await ScraperCache.removeQuiet(entry.meta.bodyPath);
      }
      await ScraperCache.removeQuiet(entry.metaPath);
      this.#log.debug('evictLru', 'evicted entry', { key: entry.key, fetchedAt: entry.meta.fetchedAt });
    }
  }

  /** Reads every meta JSON in the cache dir; ignores malformed files. */
  private async collectMetaEntries(): Promise<Array<{ key: string; metaPath: string; meta: CacheMetaInterface }>> {
    const out: Array<{ key: string; metaPath: string; meta: CacheMetaInterface }> = [];
    let shards: string[];
    try {
      shards = await readdir(this.#config.dir);
    } catch (error) {
      if (isEnoent(error)) return out;
      throw error;
    }

    for (const shard of shards) {
      if (shard.length !== 2) continue; // body dir or other artifact
      const shardDir = join(this.#config.dir, shard);
      let files: string[];
      try {
        files = await readdir(shardDir);
      } catch (error) {
        if (isEnoent(error)) continue;
        throw error;
      }
      for (const f of files) {
        if (!f.endsWith(META_SUFFIX)) continue;
        const metaPath = join(shardDir, f);
        try {
          const raw  = await readFile(metaPath, 'utf8');
          const meta = JSON.parse(raw) as CacheMetaInterface;
          const key  = `${shard}${f.slice(0, -META_SUFFIX.length)}`;
          out.push({ key, metaPath, meta });
        } catch {
          // skip malformed
        }
      }
    }
    return out;
  }

  private static async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch (error) {
      if (isEnoent(error)) return false;
      throw error;
    }
  }

  private static sortHeaders(headers: Record<string, string> | undefined): Record<string, string> {
    if (headers === undefined) return {};
    const sorted: Record<string, string> = {};
    for (const k of Object.keys(headers).sort()) {
      const value = headers[k];
      if (value !== undefined) sorted[k] = value;
    }
    return sorted;
  }

  private static async removeQuiet(path: string): Promise<void> {
    try {
      await rm(path);
    } catch (error) {
      if (isEnoent(error)) return;
      throw error;
    }
  }
}
