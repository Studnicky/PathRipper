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
    const delay = 60;
    const rl = RateLimiter.withDelay(delay);
    const stamps: number[] = [];

    await rl.schedule(async () => stamps.push(Date.now()));
    await rl.schedule(async () => stamps.push(Date.now()));
    await rl.schedule(async () => stamps.push(Date.now()));

    const a = stamps[0]!, b = stamps[1]!, c = stamps[2]!;
    assert.ok(b - a >= delay - 5, `gap1 ${(b - a).toString()} < ${delay.toString()}`);
    assert.ok(c - b >= delay - 5, `gap2 ${(c - b).toString()} < ${delay.toString()}`);
    await rl.stop();
  });

  it('perSecond(n) computes minTime as ceil(1000 / n)', async () => {
    const rl = RateLimiter.perSecond(10);
    const stamps: number[] = [];
    await rl.schedule(async () => stamps.push(Date.now()));
    await rl.schedule(async () => stamps.push(Date.now()));
    const gap = stamps[1]! - stamps[0]!;
    assert.ok(gap >= 95, `expected ≥100ms gap for perSecond(10), got ${gap.toString()}`);
    await rl.stop();
  });
});
