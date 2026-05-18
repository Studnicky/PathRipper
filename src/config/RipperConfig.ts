import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { RipperConfigSchema } from '../schemas/internal/RipperConfigSchema.js';
import type { RipperConfigInterface, NormalizedRipperConfigInterface } from '../types/Config.js';
import { RipperConfigError } from '../errors/RipperConfigError.js';

/** Default cache mode applied when no cache block is present. */
const DEFAULT_CACHE_MODE = 'read-write' as const;

/** Default cache directory template; `<targetId>` is replaced at normalization time. */
const DEFAULT_CACHE_DIR = (targetId: string) => `output/.cache/${targetId}`;

/**
 * Error message emitted when `includeRawContent` is on (default or explicit) and
 * `cache.mode` is `'off'`. Exposed as a constant so tests can assert the exact text.
 */
export const RAW_CACHE_OFF_ERROR =
  "Raw content output (`includeRawContent: true`) without a write-capable cache will exhaust disk on large scrapes; " +
  "either set `includeRawContent: false` to disable raw output, or set `cache.mode` to a write-capable mode " +
  "(`'read-write'` or `'write-only'`).";

type MutableCacheConfig = { dir: string; mode: string; ttlMs?: number };

/**
 * Returns a fully-resolved cache config for a target, applying the default when absent.
 */
function resolvedCache(
  cache: MutableCacheConfig | undefined,
  targetId: string,
): MutableCacheConfig {
  if (cache !== undefined) return cache;
  return { dir: DEFAULT_CACHE_DIR(targetId), mode: DEFAULT_CACHE_MODE };
}

/**
 * Enforces the raw-on + cache-off invariant.
 * Throws {@link RipperConfigError} when `includeRawContent !== false` and `cache.mode === 'off'`.
 */
function assertRawCacheCompatible(
  includeRawContent: boolean | undefined,
  cache: MutableCacheConfig,
  context: string,
): void {
  const rawOn = includeRawContent !== false; // true by default (undefined → true)
  if (rawOn && cache.mode === 'off') {
    throw RipperConfigError.create(
      `[${context}] ${RAW_CACHE_OFF_ERROR}`,
      { metadata: { context } },
    );
  }
}

/**
 * Loads and AJV-validates a ripperoni JSON config file.
 *
 * @remarks
 * Throws {@link RipperConfigError} on parse failure or schema violation.
 * The config path is resolved relative to the current working directory.
 *
 * After AJV validation, normalization applies two rules:
 * 1. **Cache default-on**: any `targets` or `mediawiki` entry without an explicit
 *    `cache` block receives `{ dir: "output/.cache/<targetId>", mode: "read-write" }`.
 * 2. **Raw + cache-off invariant**: when `includeRawContent` is `true` (the default)
 *    or absent, `cache.mode: "off"` is rejected with {@link RipperConfigError}.
 *
 * @example
 * ```ts
 * const config = await RipperConfig.load('./ripperoni.config.json');
 * ```
 *
 * @category Configuration
 * @since 2.0.0
 * @see {@link RipperConfigInterface}
 * @see {@link NormalizedRipperConfigInterface}
 * @group Core
 */
export class RipperConfig {
  /**
   * Reads and AJV-validates a JSON config file, then normalizes it.
   *
   * @param configPath - Path to the config JSON file (resolved to absolute).
   * @returns Normalized `NormalizedRipperConfigInterface` object.
   * @throws {RipperConfigError} When the file is missing, unparseable, fails schema
   *   validation, or violates the raw-on + cache-off invariant.
   */
  static async load(configPath: string): Promise<NormalizedRipperConfigInterface> {
    const abs  = resolve(configPath);
    const text = await readFile(abs, 'utf-8');
    const raw  = JSON.parse(text) as unknown;

    const errors = RipperConfigSchema.validate(raw);
    if (errors !== null) {
      throw RipperConfigError.create(
        `Invalid config at ${abs}:\n  ${errors}`,
        { metadata: { configPath: abs } },
      );
    }

    return RipperConfig.normalize(raw as RipperConfigInterface);
  }

  /**
   * Normalizes a validated config: applies cache defaults and enforces invariants.
   *
   * @param config - AJV-validated config (cache may be absent on targets/mediawiki).
   * @returns Config with all `cache` blocks fully resolved.
   * @throws {RipperConfigError} On raw-on + cache-off invariant violation.
   *
   * @since 2.6.0
   */
  static normalize(config: RipperConfigInterface): NormalizedRipperConfigInterface {
    const normalized = { ...config } as NormalizedRipperConfigInterface;

    if (config.targets !== undefined) {
      const targets: Record<string, unknown> = {};
      for (const [id, target] of Object.entries(config.targets)) {
        const t = target as Record<string, unknown>;
        const cache = resolvedCache(t['cache'] as MutableCacheConfig | undefined, id);
        assertRawCacheCompatible(t['includeRawContent'] as boolean | undefined, cache, `targets.${id}`);
        targets[id] = { ...t, cache };
      }
      (normalized as unknown as Record<string, unknown>)['targets'] = targets;
    }

    if (config.mediawiki !== undefined) {
      const mediawiki: Record<string, unknown> = {};
      for (const [id, target] of Object.entries(config.mediawiki)) {
        const t = target as Record<string, unknown>;
        const cache = resolvedCache(t['cache'] as MutableCacheConfig | undefined, id);
        assertRawCacheCompatible(t['includeRawContent'] as boolean | undefined, cache, `mediawiki.${id}`);
        mediawiki[id] = { ...t, cache };
      }
      (normalized as unknown as Record<string, unknown>)['mediawiki'] = mediawiki;
    }

    return normalized;
  }

  /**
   * Returns a minimal valid config with sensible output defaults.
   *
   * @returns A `RipperConfigInterface` with `output.basePath` set to `./output`.
   */
  static defaults(): RipperConfigInterface {
    return {
      output: { basePath: './output', format: 'json', pretty: true },
    };
  }
}
