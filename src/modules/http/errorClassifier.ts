// Ported from torus/src/core/errorClassifier.ts — stripped of torus node/channel machinery.

import type { ErrorCategoryType } from '../../types/Http.js';
import { ErrorCategory } from '../../types/ErrorClassifier.js';
import type {
  ClassificationResultInterface,
  ExtendedErrorInterface,
  ClassificationRuleInterface,
  ClassificationRuleOptionsType,
} from '../../types/ErrorClassifier.js';

export type { ClassificationResultInterface, ExtendedErrorInterface, ClassificationRuleInterface };

const HTTP_STATUS_THROTTLED          = 429;
const HTTP_STATUS_SERVER_MIN         = 500;
const HTTP_STATUS_CLIENT_MIN         = 400;
const HTTP_STATUS_CLIENT_MAX         = 500;
const RETRY_AFTER_DEFAULT_MS         = 5_000;
const RETRY_AFTER_SECONDS_MULTIPLIER = 1_000;

/**
 * Classifies errors into retry categories based on configurable predicate rules.
 *
 * @remarks
 * Register rules via `addRule` for custom logic, or call `ErrorClassifier.default()`
 * to get a pre-configured instance covering common HTTP and network error patterns.
 *
 * Returns `{ category, backoffHint? }` — pure classification; retry decisions
 * belong to the caller (or to `HttpRetryPolicy`).
 *
 * @example
 * ```ts
 * const classifier = ErrorClassifier.default();
 * const { category, backoffHint } = classifier.classify(error);
 * ```
 * @category Http
 * @since 2.0.0
 * @group Http
 * @see ErrorCategory
 */
export class ErrorClassifier {
  readonly #rules: ClassificationRuleInterface[] = [];

  /**
   * Registers a single classification rule.
   *
   * @param predicate - Function returning `true` when this rule matches the error.
   * @param category - Error category to assign when the predicate matches.
   * @param options - Optional `backoffHint` delay override.
   * @returns `this` for fluent chaining.
   */
  addRule(
    predicate: (error: ExtendedErrorInterface) => boolean,
    category: ErrorCategoryType,
    options: ClassificationRuleOptionsType = {},
  ): ErrorClassifier {
    this.#rules.push({ category, predicate, ...options });
    return this;
  }

  private addRules(rules: ClassificationRuleInterface[]): this {
    for (const rule of rules) this.#rules.push(rule);
    return this;
  }

  /**
   * Evaluates all registered rules against the given error.
   *
   * @param error - Error to classify.
   * @returns Classification result with category and optional backoff hint.
   */
  classify(error: ExtendedErrorInterface): ClassificationResultInterface {
    for (const rule of this.#rules) {
      if (rule.predicate(error)) {
        const hint = typeof rule.backoffHint === 'function'
          ? rule.backoffHint(error)
          : rule.backoffHint;
        const retryable = rule.retryable ?? ErrorClassifier.#defaultRetryable(rule.category);
        return hint !== undefined
          ? { category: rule.category, backoffHint: hint, retryable }
          : { category: rule.category, retryable };
      }
    }
    return { category: ErrorCategory.UNKNOWN, retryable: false };
  }

  static #defaultRetryable(category: ErrorCategoryType): boolean {
    return category === ErrorCategory.NETWORK
        || category === ErrorCategory.THROTTLED
        || category === ErrorCategory.TIMEOUT
        || category === ErrorCategory.TRANSIENT;
  }

  private static retryAfterMs(error: ExtendedErrorInterface): number {
    const h = error.headers?.['retry-after'];
    if (typeof h === 'string') {
      const n = parseInt(h, 10);
      if (Number.isFinite(n)) return n * RETRY_AFTER_SECONDS_MULTIPLIER;
    }
    if (typeof h === 'number' && Number.isFinite(h)) return h * RETRY_AFTER_SECONDS_MULTIPLIER;
    return RETRY_AFTER_DEFAULT_MS;
  }

  private static networkRules(): ClassificationRuleInterface[] {
    return [{
      predicate: (e: ExtendedErrorInterface): boolean =>
        e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET' || e.code === 'ENOTFOUND',
      category: ErrorCategory.NETWORK,
      retryable: true,
    }];
  }

  private static timeoutRules(): ClassificationRuleInterface[] {
    return [{
      predicate: (e: ExtendedErrorInterface): boolean =>
        e.code === 'ETIMEDOUT' || e.code === 'ESOCKETTIMEDOUT',
      category: ErrorCategory.TIMEOUT,
      retryable: true,
    }];
  }

  private static throttledRules(): ClassificationRuleInterface[] {
    return [{
      predicate: (e: ExtendedErrorInterface): boolean =>
        e.status === HTTP_STATUS_THROTTLED || e.statusCode === HTTP_STATUS_THROTTLED,
      category: ErrorCategory.THROTTLED,
      retryable: true,
      backoffHint: ErrorClassifier.retryAfterMs,
    }];
  }

  private static transientRules(): ClassificationRuleInterface[] {
    return [{
      predicate: (e: ExtendedErrorInterface): boolean =>
        (e.status !== undefined && e.status >= HTTP_STATUS_SERVER_MIN)
        || (e.statusCode !== undefined && e.statusCode >= HTTP_STATUS_SERVER_MIN),
      category: ErrorCategory.TRANSIENT,
      retryable: true,
    }];
  }

  private static permanentRules(): ClassificationRuleInterface[] {
    return [{
      predicate: (e: ExtendedErrorInterface): boolean =>
        (e.status !== undefined && e.status >= HTTP_STATUS_CLIENT_MIN && e.status < HTTP_STATUS_CLIENT_MAX)
        || (e.statusCode !== undefined && e.statusCode >= HTTP_STATUS_CLIENT_MIN && e.statusCode < HTTP_STATUS_CLIENT_MAX),
      category: ErrorCategory.PERMANENT,
      retryable: false,
    }];
  }

  private static validationRules(): ClassificationRuleInterface[] {
    return [{
      predicate: (e: ExtendedErrorInterface): boolean =>
        e.name === 'ValidationError' || e.name === 'TypeError' || e.name === 'SyntaxError',
      category: ErrorCategory.VALIDATION,
      retryable: false,
    }];
  }

  private static resourceRules(): ClassificationRuleInterface[] {
    return [{
      predicate: (e: ExtendedErrorInterface): boolean =>
        e.code === 'ENOMEM' || e.code === 'ENOSPC',
      category: ErrorCategory.RESOURCE,
      retryable: false,
    }];
  }

  /**
   * Creates an ErrorClassifier pre-configured with all standard HTTP and network rules.
   * Extra rules are appended after the built-in rule set so they can override or extend
   * the defaults without requiring a full custom configuration.
   *
   * @param extraRules - Optional additional classification rules applied after the defaults.
   * @returns A fully configured ErrorClassifier instance.
   */
  static default(extraRules: ClassificationRuleInterface[] = []): ErrorClassifier {
    const classifier = new ErrorClassifier()
      .addRules(ErrorClassifier.networkRules())
      .addRules(ErrorClassifier.timeoutRules())
      .addRules(ErrorClassifier.throttledRules())
      .addRules(ErrorClassifier.transientRules())
      .addRules(ErrorClassifier.permanentRules())
      .addRules(ErrorClassifier.validationRules())
      .addRules(ErrorClassifier.resourceRules());
    if (extraRules.length > 0) classifier.addRules(extraRules);
    return classifier;
  }
}
