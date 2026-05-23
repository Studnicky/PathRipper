import { readFile } from 'node:fs/promises';
import { parseAonHtml } from '../plugins/aonprd/parse.task.ts';

const fixtures = [
  ['monster-phantasmal-minion.html',  'https://2e.aonprd.com/Monsters.aspx?ID=2750'],
  ['monster-young-red-dragon.html',   'https://2e.aonprd.com/Monsters.aspx?ID=136'],
  ['monster-goblin-war-chanter.html', 'https://2e.aonprd.com/Monsters.aspx?ID=235'],
  ['monster-with-regeneration.html',  'https://2e.aonprd.com/Monsters.aspx?ID=4088'],
  ['monster-with-rituals.html',       'https://2e.aonprd.com/Monsters.aspx?ID=999'],
];

for (const [name, url] of fixtures) {
  const html = await readFile(`./tests/e2e/plugins/fixtures/aonprd/${name}`, 'utf8');
  const r = parseAonHtml(html, url);
  if (r._type !== 'monster') {
    console.log(`${name}: not a monster (${r._type})`);
    continue;
  }
  const names = r.top_abilities.map((a) => a.name);
  const orphanCount = Object.keys(r.raw_fields).length;
  console.log(`${name}: top_abilities=[${names.join(', ')}]  raw_fields_keys=${orphanCount}`);
}
