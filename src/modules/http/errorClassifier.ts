// Ported from torus/src/core/errorClassifier.ts — stripped of torus node/channel machinery.

import type { ErrorCategoryType } from '../../types/http.js';

export const ErrorCategory = Object.freeze({
  NETWORK:    'network',
  PERMANENT:  'permanent',
  RESOURCE:   'resource',
  THROTTLED:  'throttled',
  TIMEOUT:    'timeout',
  TRANSIENT:  'transient',
  UNKNOWN:    'unknown',
  VALIDATION: 'validation',
} as const);

export interface ClassificationResultInterface {
  readonly category: ErrorCategoryType;
  readonly retryable: boolean;
  readonly backoffHint?: number | undefined;
}

export interface ExtendedErrorInterface extends Error {
  readonly code?: string | undefined;
  readonly status?: number | undefined;
  readonly statusCode?: number | undefined;
  readonly headers?: Readonly<Record<string, string | number | undefined>> | undefined;
}

interface ClassificationRuleInterface {
  readonly predicate: (error: ExtendedErrorInterface) => boolean;
  readonly category: ErrorCategoryType;
  readonly retryable?: boolean | undefined;
  readonly backoffHint?: number | ((error: ExtendedErrorInterface) => number) | undefined;
}

const HTTP_STATUS_THROTTLED          = 429;
const HTTP_STATUS_SERVER_MIN         = 500;
const HTTP_STATUS_CLIENT_MIN         = 400;
const HTTP_STATUS_CLIENT_MAX         = 500;
const RETRY_AFTER_DEFAULT_MS         = 5_000;
const RETRY_AFTER_SECONDS_MULTIPLIER = 1_000;

export class ErrorClassifier {
  readonly #rules: ClassificationRuleInterface[] = [];

  addRule(
    predicate: (error: ExtendedErrorInterface) => boolean,
    category: ErrorCategoryType,
    options: Partial<Pick<ClassificationRuleInterface, 'backoffHint' | 'retryable'>> = {},
  ): this {
    this.#rules.push({ category, predicate, ...options });
    return this;
  }

  private addRules(rules: ClassificationRuleInterface[]): this {
    for (const rule of rules) this.#rules.push(rule);
    return this;
  }

  classify(error: ExtendedErrorInterface): ClassificationResultInterface {
    for (const rule of this.#rules) {
      if (rule.predicate(error)) {
        const retryable = rule.retryable ?? this.#defaultRetryable(rule.category);
        const hint = typeof rule.backoffHint === 'function'
          ? rule.backoffHint(error)
          : rule.backoffHint;
        return hint !== undefined
          ? { category: rule.category, retryable, backoffHint: hint }
          : { category: rule.category, retryable };
      }
    }
    return { category: ErrorCategory.UNKNOWN, retryable: false };
  }

  isRetryable(error: ExtendedErrorInterface): boolean {
    const result = this.classify(error);
    return result.retryable;
  }

  #defaultRetryable(category: ErrorCategoryType): boolean {
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

  static default(): ErrorClassifier {
    return new ErrorClassifier()
      .addRules(ErrorClassifier.networkRules())
      .addRules(ErrorClassifier.timeoutRules())
      .addRules(ErrorClassifier.throttledRules())
      .addRules(ErrorClassifier.transientRules())
      .addRules(ErrorClassifier.permanentRules())
      .addRules(ErrorClassifier.validationRules())
      .addRules(ErrorClassifier.resourceRules());
  }
}
