import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ErrorClassifier, ErrorCategory } from '../../../../src/modules/http/errorClassifier.js';
import type { ExtendedErrorInterface } from '../../../../src/modules/http/errorClassifier.js';

function err(props: Partial<ExtendedErrorInterface>): ExtendedErrorInterface {
  return Object.assign(new Error('test'), props);
}

describe('ErrorClassifier.default()', () => {
  const classifier = ErrorClassifier.default();

  it('classifies ECONNREFUSED as NETWORK retryable', () => {
    const r = classifier.classify(err({ code: 'ECONNREFUSED' }));
    assert.equal(r.category, ErrorCategory.NETWORK);
    assert.equal(r.retryable, true);
  });

  it('classifies ENOTFOUND as NETWORK retryable', () => {
    const r = classifier.classify(err({ code: 'ENOTFOUND' }));
    assert.equal(r.category, ErrorCategory.NETWORK);
    assert.equal(r.retryable, true);
  });

  it('classifies ETIMEDOUT as TIMEOUT retryable', () => {
    const r = classifier.classify(err({ code: 'ETIMEDOUT' }));
    assert.equal(r.category, ErrorCategory.TIMEOUT);
    assert.equal(r.retryable, true);
  });

  it('classifies HTTP 429 as THROTTLED retryable with default backoff', () => {
    const r = classifier.classify(err({ status: 429 }));
    assert.equal(r.category, ErrorCategory.THROTTLED);
    assert.equal(r.retryable, true);
    assert.equal(r.backoffHint, 5_000);
  });

  it('respects Retry-After header on 429 (seconds → ms)', () => {
    const r = classifier.classify(err({ status: 429, headers: { 'retry-after': '30' } }));
    assert.equal(r.category, ErrorCategory.THROTTLED);
    assert.equal(r.backoffHint, 30_000);
  });

  it('classifies HTTP 503 as TRANSIENT retryable', () => {
    const r = classifier.classify(err({ status: 503 }));
    assert.equal(r.category, ErrorCategory.TRANSIENT);
    assert.equal(r.retryable, true);
  });

  it('classifies HTTP 404 as PERMANENT non-retryable', () => {
    const r = classifier.classify(err({ status: 404 }));
    assert.equal(r.category, ErrorCategory.PERMANENT);
    assert.equal(r.retryable, false);
  });

  it('classifies TypeError as VALIDATION non-retryable', () => {
    const e = Object.assign(new TypeError('bad'), {}) as ExtendedErrorInterface;
    const r = classifier.classify(e);
    assert.equal(r.category, ErrorCategory.VALIDATION);
    assert.equal(r.retryable, false);
  });

  it('classifies ENOMEM as RESOURCE non-retryable', () => {
    const r = classifier.classify(err({ code: 'ENOMEM' }));
    assert.equal(r.category, ErrorCategory.RESOURCE);
    assert.equal(r.retryable, false);
  });

  it('returns UNKNOWN non-retryable for unmatched errors', () => {
    const r = classifier.classify(err({}));
    assert.equal(r.category, ErrorCategory.UNKNOWN);
    assert.equal(r.retryable, false);
  });

  it('isRetryable() short-circuits to the retryable flag', () => {
    assert.equal(classifier.isRetryable(err({ code: 'ECONNREFUSED' })), true);
    assert.equal(classifier.isRetryable(err({ status: 404 })), false);
  });
});
