import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseDnd5eHtml } from '../../plugins/dnd5e/parse.task.js';
import type { SpellOutput } from '../../plugins/dnd5e/concepts/spell.js';
import type { GenericOutput } from '../../plugins/dnd5e/concepts/generic.js';

const FIXTURE_DIR = resolve(import.meta.dirname, 'fixtures/dnd5e/pages');

test('Fireball parses as a typed spell', async () => {
  const html = readFileSync(resolve(FIXTURE_DIR, 'Fireball.html'), 'utf-8');
  const result = await parseDnd5eHtml(html, 'https://www.dandwiki.com/wiki/5e_SRD:Fireball') as SpellOutput;

  console.log('Fireball JSON keys:', Object.keys(result));
  console.log('Fireball result:', JSON.stringify(result, null, 2));

  assert.equal(result.name, 'Fireball');
  assert.equal(result.level, 3);
  assert.equal(result.school, 'evocation');
  assert.equal(result.casting_time, '1 action');
  assert.equal(result.range, '150 feet');
  assert.ok(result.components !== null && result.components.includes('V, S, M'), `components: ${result.components}`);
  assert.equal(result.duration, 'Instantaneous');
  assert.equal(result.source.book, '5e SRD');
  assert.ok(result.description_text.includes('8d6'), `description_text: ${result.description_text}`);
  assert.ok(result.higher_levels !== null && result.higher_levels.includes('1d6'), `higher_levels: ${result.higher_levels}`);
});

test('Goblin falls back to generic output', async () => {
  const html = readFileSync(resolve(FIXTURE_DIR, 'Goblin.html'), 'utf-8');
  const result = await parseDnd5eHtml(html, 'https://www.dandwiki.com/wiki/5e_SRD:Goblin') as GenericOutput;

  assert.equal(result.name, 'Goblin');
  assert.equal(result.source.book, '5e SRD');
  assert.ok(result.body_text.length > 0, 'body_text should be non-empty');
});
