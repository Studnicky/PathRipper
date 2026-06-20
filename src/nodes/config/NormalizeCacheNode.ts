import { ScalarNode, NodeOutputBuilder, NodeErrorBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer';
import type { OperationContractType } from '@studnicky/dagonizer/contracts';

import { RipperConfigError } from '../../errors/RipperConfigError.js';
import type { NormalizedRipperConfigInterface } from '../../types/Config.js';
import type { ConfigLoadState } from '../../state/ConfigLoadState.js';

/**
 * Error message emitted when `includeRawContent` is on (default or explicit) and
 * `cache.mode` is `'off'`. Exposed as a named export so `RipperConfig` and tests
 * can assert the exact text.
 */
export const RAW_CACHE_OFF_ERROR =
  "Raw content output (`includeRawContent: true`) without a write-capable cache will exhaust disk on large scrapes; " +
  "either set `includeRawContent: false` to disable raw output, or set `cache.mode` to a write-capable mode " +
  "(`'read-write'` or `'write-only'`).";

/** Default cache mode applied when no cache block is present. */
const DEFAULT_CACHE_MODE = 'read-write' as const;

/** Default cache directory template; `targetId` is replaced at normalization time. */
const defaultCacheDir = (targetId: string): string => `output/.cache/${targetId}`;

type MutableCacheConfig = { dir: string; mode: string; ttlMs?: number };

/**
 * Returns a fully-resolved cache config for a target, applying the default when absent.
 */
function resolvedCache(
  cache: MutableCacheConfig | undefined,
  targetId: string,
): MutableCacheConfig {
  if (cache !== undefined) return cache;
  return { dir: defaultCacheDir(targetId), mode: DEFAULT_CACHE_MODE };
}

/**
 * Asserts the raw-on + cache-off invariant.
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

type NormalizeCacheOutput = 'success' | 'invariant-violated';

/** OperationContractType for NormalizeCacheNode: reads validated, produces normalized. */
export const normalizeCacheContract: OperationContractType = {
  name:         'config:normalize-cache',
  hardRequired: ['validated'],
  produces:     ['normalized'],
  outputs:      ['success', 'invariant-violated'],
};

/**
 * Applies cache defaults and enforces the raw-on + cache-off invariant for every
 * `targets` and `mediawiki` entry in `state.validated`.
 *
 * This node owns the normalization logic migrated out of `RipperConfig.normalize()`.
 *
 * Output ports:
 * - `success`             — normalized successfully; `state.normalized` is populated.
 * - `invariant-violated`  — raw-on + cache-off combination detected;
 *                           a `RipperConfigError` is recorded on state.
 *
 * @category Nodes
 * @since 3.0.0
 */
class NormalizeCacheNodeImpl extends ScalarNode<ConfigLoadState, NormalizeCacheOutput, undefined> {
  public readonly name = 'config:normalize-cache';
  public readonly outputs = ['success', 'invariant-violated'] as const;
  public override readonly contract = normalizeCacheContract;

  protected override async executeOne(
    state: ConfigLoadState,
    _context: NodeContextType<undefined>,
  ): Promise<NodeOutputType<NormalizeCacheOutput>> {
    if (state.validated === null) {
      state.collectError(NodeErrorBuilder.from(
        'PRECONDITION_FAILED',
        'config:normalize-cache requires state.validated to be set',
        'config:normalize-cache',
        false,
        new Date().toISOString(),
      ));
      return NodeOutputBuilder.of('invariant-violated');
    }

    const config = state.validated;
    const normalized = { ...config } as NormalizedRipperConfigInterface;

    try {
      if (config.targets !== undefined) {
        const targets: Record<string, unknown> = {};
        for (const [targetId, target] of Object.entries(config.targets)) {
          const cfg = target as Record<string, unknown>;
          const cache = resolvedCache(cfg['cache'] as MutableCacheConfig | undefined, targetId);
          assertRawCacheCompatible(cfg['includeRawContent'] as boolean | undefined, cache, `targets.${targetId}`);
          targets[targetId] = { ...cfg, cache };
        }
        (normalized as unknown as Record<string, unknown>)['targets'] = targets;
      }

      if (config.mediawiki !== undefined) {
        const mediawiki: Record<string, unknown> = {};
        for (const [targetId, target] of Object.entries(config.mediawiki)) {
          const cfg = target as Record<string, unknown>;
          const cache = resolvedCache(cfg['cache'] as MutableCacheConfig | undefined, targetId);
          assertRawCacheCompatible(cfg['includeRawContent'] as boolean | undefined, cache, `mediawiki.${targetId}`);
          mediawiki[targetId] = { ...cfg, cache };
        }
        (normalized as unknown as Record<string, unknown>)['mediawiki'] = mediawiki;
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      state.collectError(NodeErrorBuilder.from(
        (error as { code?: string }).code ?? 'RIPPER_CONFIG',
        error.message,
        'config:normalize-cache',
        false,
        new Date().toISOString(),
      ));
      return NodeOutputBuilder.of('invariant-violated');
    }

    state.normalized = normalized;
    return NodeOutputBuilder.of('success');
  }
}

export const NormalizeCacheNode = new NormalizeCacheNodeImpl();
