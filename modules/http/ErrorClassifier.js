// Ported from torus/src/core/errorClassifier.ts — stripped of torus node/channel machinery.
export const ErrorCategory = Object.freeze({
    NETWORK: 'network',
    PERMANENT: 'permanent',
    RESOURCE: 'resource',
    THROTTLED: 'throttled',
    TIMEOUT: 'timeout',
    TRANSIENT: 'transient',
    UNKNOWN: 'unknown',
    VALIDATION: 'validation',
});
export class ErrorClassifier {
    #rules = [];
    addRule(predicate, category, options = {}) {
        this.#rules.push({ category, predicate, ...options });
        return this;
    }
    classify(error) {
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
    isRetryable(error) {
        return this.classify(error).retryable;
    }
    #defaultRetryable(category) {
        return category === ErrorCategory.NETWORK
            || category === ErrorCategory.THROTTLED
            || category === ErrorCategory.TIMEOUT
            || category === ErrorCategory.TRANSIENT;
    }
    static retryAfterMs(error) {
        const h = error.headers?.['retry-after'];
        if (typeof h === 'string') {
            const n = parseInt(h, 10);
            if (Number.isFinite(n))
                return n * 1_000;
        }
        if (typeof h === 'number' && Number.isFinite(h))
            return h * 1_000;
        return 5_000;
    }
    static default() {
        return new ErrorClassifier()
            .addRule((e) => e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET' || e.code === 'ENOTFOUND', ErrorCategory.NETWORK, { retryable: true })
            .addRule((e) => e.code === 'ETIMEDOUT' || e.code === 'ESOCKETTIMEDOUT', ErrorCategory.TIMEOUT, { retryable: true })
            .addRule((e) => e.status === 429 || e.statusCode === 429, ErrorCategory.THROTTLED, { retryable: true, backoffHint: ErrorClassifier.retryAfterMs })
            .addRule((e) => (e.status !== undefined && e.status >= 500)
            || (e.statusCode !== undefined && e.statusCode >= 500), ErrorCategory.TRANSIENT, { retryable: true })
            .addRule((e) => (e.status !== undefined && e.status >= 400 && e.status < 500)
            || (e.statusCode !== undefined && e.statusCode >= 400 && e.statusCode < 500), ErrorCategory.PERMANENT, { retryable: false })
            .addRule((e) => e.name === 'ValidationError' || e.name === 'TypeError' || e.name === 'SyntaxError', ErrorCategory.VALIDATION, { retryable: false })
            .addRule((e) => e.code === 'ENOMEM' || e.code === 'ENOSPC', ErrorCategory.RESOURCE, { retryable: false });
    }
}
