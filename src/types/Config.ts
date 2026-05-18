import type { FromSchema } from 'json-schema-to-ts';
import type { RipperConfigSchema } from '../schemas/internal/RipperConfigSchema.js';

/**
 * Validated ripperoni configuration, derived from the JSON Schema via `json-schema-to-ts`.
 *
 * @remarks
 * The shape is authoritative — editing the schema constant in `RipperConfigSchema` changes
 * this type automatically. Load and validate an instance with {@link RipperConfig.load}.
 *
 * Note: After loading, `cache` blocks on targets and mediawiki entries may be absent
 * (the schema treats them as optional). Use {@link NormalizedRipperConfigInterface} for
 * the fully-resolved shape where `cache` is guaranteed to be present.
 *
 * @example
 * ```ts
 * const config: RipperConfigInterface = await RipperConfig.load('./ripperoni.config.json');
 * console.log(config.output.basePath);
 * ```
 *
 * @category Configuration
 * @since 2.0.0
 * @see {@link RipperConfig}
 * @group Types
 */
export type RipperConfigInterface = FromSchema<typeof RipperConfigSchema.SCHEMA>;

/**
 * Resolved cache config block guaranteed to be fully populated.
 *
 * @category Configuration
 * @since 2.6.0
 * @group Types
 */
export interface ResolvedCacheConfigInterface {
  readonly dir:    string;
  readonly mode:   'read-write' | 'read-only' | 'write-only' | 'off';
  readonly ttlMs?: number | undefined;
}

/**
 * A single target entry after normalization — `cache` is always present.
 *
 * @category Configuration
 * @since 2.6.0
 * @group Types
 */
export type NormalizedTargetConfigInterface = Omit<
  NonNullable<NonNullable<RipperConfigInterface['targets']>[string]>,
  'cache'
> & { readonly cache: ResolvedCacheConfigInterface };

/**
 * A single mediawiki entry after normalization — `cache` is always present.
 *
 * @category Configuration
 * @since 2.6.0
 * @group Types
 */
export type NormalizedWikiConfigInterface = Omit<
  NonNullable<NonNullable<RipperConfigInterface['mediawiki']>[string]>,
  'cache'
> & { readonly cache: ResolvedCacheConfigInterface };

/**
 * Post-normalization ripperoni configuration.
 *
 * @remarks
 * Every `targets` and `mediawiki` entry carries a fully-resolved `cache` block.
 * Produced by {@link RipperConfig.load} and {@link RipperConfig.normalize}.
 * Downstream scrapers should accept this type so they can rely on `cache` being present.
 *
 * @category Configuration
 * @since 2.6.0
 * @see {@link RipperConfig}
 * @group Types
 */
export interface NormalizedRipperConfigInterface {
  readonly output:     RipperConfigInterface['output'];
  readonly targets?:   Record<string, NormalizedTargetConfigInterface> | undefined;
  readonly mediawiki?: Record<string, NormalizedWikiConfigInterface> | undefined;
  readonly crawlers?:  RipperConfigInterface['crawlers'];
}
