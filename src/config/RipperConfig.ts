import { resolve } from 'node:path';

import { Dagonizer } from '@studnicky/dagonizer';

import { configLoadFlow, CONFIG_LOAD_FLOW } from '../flows/configLoadFlow.js';
import { ReadFileNode }             from '../nodes/config/ReadFileNode.js';
import { ParseJsonNode }            from '../nodes/config/ParseJsonNode.js';
import { ValidateConfigSchemaNode } from '../nodes/config/ValidateConfigSchemaNode.js';
import { NormalizeCacheNode }       from '../nodes/config/NormalizeCacheNode.js';
import { AssertInvariantsNode }     from '../nodes/config/AssertInvariantsNode.js';
import { ConfigLoadState }          from '../state/ConfigLoadState.js';
import type { RipperConfigType, NormalizedRipperConfigType } from '../types/Config.js';
import { RipperConfigError } from '../errors/RipperConfigError.js';

// Re-export RAW_CACHE_OFF_ERROR so external callers and tests can import it
// from the canonical config module without knowing the node implementation path.
export { RAW_CACHE_OFF_ERROR } from '../nodes/config/NormalizeCacheNode.js';

// ── Module-scoped dispatcher (built once, reused across calls) ─────────────────

const _dispatcher = new Dagonizer<ConfigLoadState>();
_dispatcher.registerNode(ReadFileNode);
_dispatcher.registerNode(ParseJsonNode);
_dispatcher.registerNode(ValidateConfigSchemaNode);
_dispatcher.registerNode(NormalizeCacheNode);
_dispatcher.registerNode(AssertInvariantsNode);
_dispatcher.registerDAG(configLoadFlow);

/**
 * Loads and AJV-validates a ripperoni JSON config file.
 *
 * @remarks
 * Dispatches the `configLoadDAG` through `@studnicky/dagonizer`. The five-node
 * pipeline is:
 *
 * ```
 * read-file → parse-json → validate-schema → normalize-cache → assert-invariants
 * ```
 *
 * Each step routes non-success outputs to `null` (terminates the run);
 * `state.errors` carries the collected failure details. On failure the errors
 * are merged into a single `RipperConfigError` message and thrown.
 *
 * Throws {@link RipperConfigError} on any failure (file missing, parse error,
 * schema violation, or invariant violation).
 *
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
 * @see {@link RipperConfigType}
 * @see {@link NormalizedRipperConfigType}
 * @group Core
 */
export class RipperConfig {
  /**
   * Reads and AJV-validates a JSON config file, then normalizes it.
   *
   * @param configPath - Path to the config JSON file (resolved to absolute).
   * @returns Normalized `NormalizedRipperConfigType` object.
   * @throws {RipperConfigError} When the file is missing, unparseable, fails schema
   *   validation, or violates the raw-on + cache-off invariant.
   */
  static async load(configPath: string): Promise<NormalizedRipperConfigType> {
    const state = new ConfigLoadState();
    state.path  = resolve(configPath);

    const result = await _dispatcher.execute(CONFIG_LOAD_FLOW, state);

    if (result.state.normalized !== null) {
      return result.state.normalized;
    }

    // Extract errors from state and throw a single RipperConfigError.
    const messages = result.state.errors.map((error) => error.message);
    const combined = messages.length > 0
      ? messages.join('\n  ')
      : 'Config load failed (unknown error)';

    throw RipperConfigError.create(combined, { metadata: { configPath: state.path } });
  }

  /**
   * Returns a minimal valid config with sensible output defaults.
   *
   * @returns A `RipperConfigType` with `output.basePath` set to `./output`.
   */
  static defaults(): RipperConfigType {
    return {
      output: { basePath: './output', format: 'json', pretty: true },
    };
  }
}
