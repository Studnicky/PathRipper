import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { RateLimiter } from '../../../../src/modules/http/rateLimiter.js';

describe('RateLimiter', () => {
  it('schedule() returns the resolved value of the wrapped fn', async () => {
    const rl = RateLimiter.withDelay(0);
    const result = await rl.schedule(async () => 'value');
    assert.equal(result, 'value');
    await rl.stop();
  });

  it('withDelay enforces a minimum delay between sequential calls', async () => {
    // Use 300ms so the ±50% OS scheduler variance still produces a measurable gap.
    const delay = 300;
    const rl = RateLimiter.withDelay(delay);
    const stamps: number[] = [];

    await rl.schedule(async () => stamps.push(Date.now()));
    await rl.schedule(async () => stamps.push(Date.now()));
    await rl.schedule(async () => stamps.push(Date.now()));

    const a = stamps[0]!, b = stamps[1]!, c = stamps[2]!;
    assert.ok(b - a >= delay / 2, `gap1 ${(b - a).toString()} < ${(delay / 2).toString()}`);
    assert.ok(c - b >= delay / 2, `gap2 ${(c - b).toString()} < ${(delay / 2).toString()}`);
    await rl.stop();
  });

  it('perSecond(n) computes minTime as ceil(1000 / n)', async () => {
    // perSecond(5) = 200ms gap — large enough to survive scheduler jitter.
    const rl = RateLimiter.perSecond(5);
    const stamps: number[] = [];
    await rl.schedule(async () => stamps.push(Date.now()));
    await rl.schedule(async () => stamps.push(Date.now()));
    const gap = stamps[1]! - stamps[0]!;
    assert.ok(gap >= 100, `expected ≥200ms gap for perSecond(5), got ${gap.toString()}`);
    await rl.stop();
  });
});
