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
 * (the schema treats them as optional). Use {@link NormalizedRipperConfigType} for
 * the fully-resolved shape where `cache` is guaranteed to be present.
 *
 * @example
 * ```ts
 * const config: RipperConfigType = await RipperConfig.load('./ripperoni.config.json');
 * console.log(config.output.basePath);
 * ```
 *
 * @category Configuration
 * @since 2.0.0
 * @see {@link RipperConfig}
 * @group Types
 */
export type RipperConfigType = FromSchema<typeof RipperConfigSchema.SCHEMA>;

/**
 * Resolved cache config block guaranteed to be fully populated.
 *
 * @category Configuration
 * @since 2.6.0
 * @group Types
 */
export type ResolvedCacheConfigType = {
  readonly dir:    string;
  readonly mode:   'read-write' | 'read-only' | 'write-only' | 'off';
  readonly ttlMs?: number | undefined;
};

/**
 * A single target entry after normalization — `cache` is always present.
 *
 * @category Configuration
 * @since 2.6.0
 * @group Types
 */
export type NormalizedTargetConfigType = Omit<
  NonNullable<NonNullable<RipperConfigType['targets']>[string]>,
  'cache'
> & { readonly cache: ResolvedCacheConfigType };

/**
 * A single mediawiki entry after normalization — `cache` is always present.
 *
 * @category Configuration
 * @since 2.6.0
 * @group Types
 */
export type NormalizedWikiConfigType = Omit<
  NonNullable<NonNullable<RipperConfigType['mediawiki']>[string]>,
  'cache'
> & { readonly cache: ResolvedCacheConfigType };

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
export type NormalizedRipperConfigType = {
  readonly output:     RipperConfigType['output'];
  readonly targets?:   Record<string, NormalizedTargetConfigType> | undefined;
  readonly mediawiki?: Record<string, NormalizedWikiConfigType> | undefined;
  readonly crawlers?:  RipperConfigType['crawlers'];
};
