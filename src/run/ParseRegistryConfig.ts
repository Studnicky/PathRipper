/**
 * ParseRegistryConfig — shared constants and types for the worker registry module.
 *
 * Exports only plain values and JSON-serialisable types; no plugin imports.
 * Both `runDag` (coordinator) and `workers/ParseRegistryModule` (isolate) import
 * from here so the registry version and services-config shape stay in sync
 * from a single source.
 *
 * @module run/ParseRegistryConfig
 * @since 4.2.0
 */

// ── Registry version ────────────────────────────────────────────────────────────
// Must match the `registryVersion` passed to `WorkerThreadContainer` in runDag
// and returned by the registry module's `instantiate`. Bump on any breaking
// change to the services-config shape or the bundle contents.

/** Semantic version used for the WorkerThreadContainer init ↔ ready handshake. */
export const REGISTRY_VERSION = '1.0.0';

// ── ServicesConfig shape ────────────────────────────────────────────────────────
// JSON-serialisable config the coordinator passes to each worker isolate.
// The isolate's `ParseRegistryModule.instantiate` interprets this object to
// reconstruct the `RipperServices` bag locally — services never cross the
// thread boundary.

type CacheConfigType = {
  readonly dir:   string;
  readonly mode:  'read-write' | 'read-only' | 'write-only' | 'off';
  readonly ttlMs: number | undefined;
};

/**
 * JSON-serialisable config the coordinator passes to worker isolates via
 * `WorkerThreadContainer`'s `servicesConfig` option.
 *
 * `instantiate(servicesConfig)` in `workers/ParseRegistryModule.ts` casts
 * the opaque `JsonObjectType` back to this shape and uses it to rebuild the
 * services bag locally.
 *
 * Extend here when additional services need reconstructing inside workers.
 *
 * @category Configuration
 * @since 4.2.0
 */
export type WorkerServicesConfigType = {
  readonly outDir:              string;
  readonly targetId:            string;
  readonly pluginTaskName:      string | undefined;
  readonly splitByTaskName:     boolean | undefined;
  readonly baseUrl:             string | undefined;
  readonly rateLimitMs:         number | undefined;
  readonly jitterMs:            number | undefined;
  readonly apiUrl:              string | undefined;
  readonly apiRateLimitMs:      number | undefined;
  readonly apiJitterMs:         number | undefined;
  readonly headers:             Record<string, string> | undefined;
  readonly useJsdom:            boolean | undefined;
  readonly jsdomLoadTimeoutMs:  number | undefined;
  readonly includeRawContent:   boolean | undefined;
  readonly outputSchema:        string | undefined;
  readonly onSchemaError:       'halt' | 'skip' | 'warn' | undefined;
  readonly cache:               CacheConfigType | undefined;
};
