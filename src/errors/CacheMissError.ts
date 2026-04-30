import { BaseError } from './BaseError.js';
import type { BaseErrorOptionsInterface } from '../types/BaseError.js';

/**
 * Construction options for `CacheMissError`, extending `BaseErrorOptionsInterface` with cache context.
 *
 * @category Errors
 * @since 2.0.0
 * @see {@link BaseErrorOptionsInterface}
 * @group Types
 */
export interface CacheMissErrorOptionsInterface extends BaseErrorOptionsInterface {
  /** Cache key that produced the miss, if available. */
  readonly key?: string | undefined;
  /** Request URL associated with the miss, if available. */
  readonly url?: string | undefined;
}

/**
 * Thrown by cache-aware scrapers when a `read-only` cache encounters a miss.
 *
 * @remarks
 * Not retryable — there's nothing to retry against, since the cache is
 * authoritative in `read-only` mode. The orchestrator catches this and routes
 * the affected URL into the failures manifest.
 *
 * @example
 * ```ts
 * throw CacheMissError.create(`cache miss in read-only mode: ${url}`, { key, url });
 * ```
 *
 * @category Errors
 * @since 2.0.0
 * @see {@link BaseError}
 * @group Core
 */
export class CacheMissError extends BaseError {
  /** Cache key that produced the miss, if available. */
  public readonly key: string | undefined;
  /** Request URL associated with the miss, if available. */
  public readonly url: string | undefined;

  /**
   * @param message - Human-readable error description.
   * @param options - Optional key, url, cause, and metadata.
   */
  private constructor(message: string, options: CacheMissErrorOptionsInterface = {}) {
    super(message, { retryable: false, ...options });
    this.key = options.key;
    this.url = options.url;
  }

  /**
   * Creates a CacheMissError instance.
   *
   * @param message - Human-readable error description.
   * @param options - Optional key, url, cause, and metadata.
   * @returns A new CacheMissError.
   */
  public static create(message: string, options: CacheMissErrorOptionsInterface = {}): CacheMissError {
    return new CacheMissError(message, options);
  }
}
