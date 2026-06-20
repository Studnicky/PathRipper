import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ErrorClassifier } from '../../../../src/modules/http/errorClassifier.js';
import type { ExtendedErrorInterface } from '../../../../src/modules/http/errorClassifier.js';
import { ErrorCategory } from '../../../../src/types/ErrorClassifier.js';

function err(props: Partial<ExtendedErrorInterface>): ExtendedErrorInterface {
  return Object.assign(new Error('test'), props);
}

describe('ErrorClassifier.default()', () => {
  const classifier = ErrorClassifier.default();

  it('classifies ECONNREFUSED as NETWORK', () => {
    const result = classifier.classify(err({ code: 'ECONNREFUSED' }));
    assert.equal(result.category, ErrorCategory.NETWORK);
  });

  it('classifies ENOTFOUND as NETWORK', () => {
    const result = classifier.classify(err({ code: 'ENOTFOUND' }));
    assert.equal(result.category, ErrorCategory.NETWORK);
  });

  it('classifies ETIMEDOUT as TIMEOUT', () => {
    const result = classifier.classify(err({ code: 'ETIMEDOUT' }));
    assert.equal(result.category, ErrorCategory.TIMEOUT);
  });

  it('classifies HTTP 429 as THROTTLED with default backoff hint', () => {
    const result = classifier.classify(err({ status: 429 }));
    assert.equal(result.category, ErrorCategory.THROTTLED);
    assert.equal(result.backoffHint, 5_000);
  });

  it('respects Retry-After header on 429 (seconds → ms)', () => {
    const result = classifier.classify(err({ status: 429, headers: { 'retry-after': '30' } }));
    assert.equal(result.category, ErrorCategory.THROTTLED);
    assert.equal(result.backoffHint, 30_000);
  });

  it('classifies HTTP 503 as TRANSIENT', () => {
    const result = classifier.classify(err({ status: 503 }));
    assert.equal(result.category, ErrorCategory.TRANSIENT);
  });

  it('classifies HTTP 404 as PERMANENT', () => {
    const result = classifier.classify(err({ status: 404 }));
    assert.equal(result.category, ErrorCategory.PERMANENT);
  });

  it('classifies TypeError as VALIDATION', () => {
    const error = Object.assign(new TypeError('bad'), {}) as ExtendedErrorInterface;
    const result = classifier.classify(error);
    assert.equal(result.category, ErrorCategory.VALIDATION);
  });

  it('classifies ENOMEM as RESOURCE', () => {
    const result = classifier.classify(err({ code: 'ENOMEM' }));
    assert.equal(result.category, ErrorCategory.RESOURCE);
  });

  it('returns UNKNOWN for unmatched errors', () => {
    const result = classifier.classify(err({}));
    assert.equal(result.category, ErrorCategory.UNKNOWN);
  });
});
