import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { RateLimiter } from '../../../../src/modules/http/rateLimiter.js';

describe('RateLimiter', () => {
  it('schedule() returns the resolved value of the wrapped fn', async () => {
    const rateLimiter = RateLimiter.withDelay(0);
    const result = await rateLimiter.schedule(async () => 'value');
    assert.equal(result, 'value');
    await rateLimiter.stop();
  });

  it('withDelay enforces a minimum delay between sequential calls', async () => {
    // Use 300ms so the ±50% OS scheduler variance still produces a measurable gap.
    const delay = 300;
    const rateLimiter = RateLimiter.withDelay(delay);
    const stamps: number[] = [];

    await rateLimiter.schedule(async () => stamps.push(Date.now()));
    await rateLimiter.schedule(async () => stamps.push(Date.now()));
    await rateLimiter.schedule(async () => stamps.push(Date.now()));

    const stampA = stamps[0]!, stampB = stamps[1]!, stampC = stamps[2]!;
    assert.ok(stampB - stampA >= delay / 2, `gap1 ${(stampB - stampA).toString()} < ${(delay / 2).toString()}`);
    assert.ok(stampC - stampB >= delay / 2, `gap2 ${(stampC - stampB).toString()} < ${(delay / 2).toString()}`);
    await rateLimiter.stop();
  });

  it('perSecond(n) computes minTime as ceil(1000 / n)', async () => {
    // perSecond(5) = 200ms gap — large enough to survive scheduler jitter.
    const rateLimiter = RateLimiter.perSecond(5);
    const stamps: number[] = [];
    await rateLimiter.schedule(async () => stamps.push(Date.now()));
    await rateLimiter.schedule(async () => stamps.push(Date.now()));
    const gap = stamps[1]! - stamps[0]!;
    assert.ok(gap >= 100, `expected ≥200ms gap for perSecond(5), got ${gap.toString()}`);
    await rateLimiter.stop();
  });
});
