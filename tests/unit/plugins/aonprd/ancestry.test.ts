// Unit tests for the AON ancestry extractor — `plugins/aonprd/ancestry.ts`.
// Covers base slice (mechanics: HP/size/speed/languages/boosts/flaws), heritages,
// features, and raw_fields strip on the Goblin fixture.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseAonHtml } from '../../../../plugins/aonprd/parse.task.js';
import { loadFixture }  from './nodes/helpers.js';

// ─── Base slice ───────────────────────────────────────────────────────────────

describe('extractAncestry — base slice (Goblin fixture)', () => {
  it('captures _type and name', async () => {
    const html = await loadFixture('ancestry-goblin.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    assert.equal((out as unknown as { name: string }).name, 'Goblin');
  });

  it('extracts mechanics.hit_points from h2 section', async () => {
    const html = await loadFixture('ancestry-goblin.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    const mech = (out as unknown as { mechanics: { hit_points: number | null } }).mechanics;
    assert.equal(mech.hit_points, 6);
  });

  it('extracts mechanics.size = Small', async () => {
    const html = await loadFixture('ancestry-goblin.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    const mech = (out as unknown as { mechanics: { size: string | null } }).mechanics;
    assert.equal(mech.size, 'Small');
  });

  it('extracts mechanics.speed = 25', async () => {
    const html = await loadFixture('ancestry-goblin.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    const mech = (out as unknown as { mechanics: { speed: number | null } }).mechanics;
    assert.equal(mech.speed, 25);
  });

  it('extracts mechanics.attribute_boosts as list with Dexterity', async () => {
    const html = await loadFixture('ancestry-goblin.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    const mech = (out as unknown as { mechanics: { attribute_boosts: string[] } }).mechanics;
    assert.ok(mech.attribute_boosts.includes('Dexterity'), 'Goblin should have Dexterity boost');
  });

  it('extracts mechanics.attribute_flaws non-empty', async () => {
    const html = await loadFixture('ancestry-goblin.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    const mech = (out as unknown as { mechanics: { attribute_flaws: string[] } }).mechanics;
    assert.ok(mech.attribute_flaws.length > 0, 'Goblin should have attribute flaw');
  });

  it('parses popular_edicts and popular_anathema', async () => {
    const html = await loadFixture('ancestry-goblin.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    const record = out as unknown as { popular_edicts: string | null; popular_anathema: string | null };
    assert.ok(record.popular_edicts !== null && record.popular_edicts.length > 0, 'should have popular edicts');
    assert.ok(record.popular_anathema !== null && record.popular_anathema.length > 0, 'should have popular anathema');
  });
});

// ─── Features slice ───────────────────────────────────────────────────────────

describe('extractAncestry — features slice', () => {
  it('captures free-form h2 sections (You Might…, Beliefs, Names)', async () => {
    const html = await loadFixture('ancestry-goblin.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    const features = (out as unknown as { features: Array<{ name: string }> }).features;
    const names = features.map((feat) => feat.name);
    assert.ok(names.length > 0, 'should have at least one feature');
    // Goblin fixture should have prose sections like "You Might..." or "Beliefs"
    const hasNarrative = names.some((name) => /You Might|Beliefs|Names|Society|Physical/i.test(name));
    assert.ok(hasNarrative, `expected narrative feature headings, got: ${names.join(', ')}`);
  });
});

// ─── Raw fields strip ─────────────────────────────────────────────────────────

describe('extractAncestry — raw_fields strip', () => {
  it('does not contain claimed mechanic labels (Hit Points, Size, Speed)', async () => {
    const html = await loadFixture('ancestry-goblin.html');
    const out  = await parseAonHtml(html, 'https://2e.aonprd.com/Ancestries.aspx?ID=4');
    const rawFields = (out as unknown as { raw_fields: Record<string, string> }).raw_fields;
    for (const claimed of ['Hit Points', 'Size', 'Speed', 'Languages']) {
      assert.ok(!(claimed in rawFields), `${claimed} should be stripped from raw_fields`);
    }
  });
});
