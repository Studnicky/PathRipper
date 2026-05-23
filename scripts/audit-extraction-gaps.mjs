// Sharp audit: per _type, find raw_fields keys that have NO structured
// equivalent at the top level. Those are the real extraction misses.
// Heuristic mapping: a raw_fields key "X Y" maps to a structured field
// `x_y` (snake_case) or `xy` (lowercased concatenation) on the record.
import { readdirSync, readFileSync } from 'node:fs';
import { parseAonHtml } from '../plugins/aonprd/parse.task.ts';

const rawDir = './output-live/aonprd/aonprd/raw';
const allFiles = readdirSync(rawDir).filter((f) => f.endsWith('.html'));

const byKind = new Map();
for (const f of allFiles) {
  const m = /^([A-Za-z]+)\.aspx/.exec(f);
  if (!m) continue;
  if (!byKind.has(m[1])) byKind.set(m[1], []);
  byKind.get(m[1]).push(f);
}

const SAMPLE_N = 30;
const orphans = new Map(); // _type → Map<key, count>
const counts = new Map();

function candidateKeys(rawKey) {
  const trimmed = rawKey.trim();
  const lower = trimmed.toLowerCase();
  const snake = lower.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const compact = lower.replace(/[^a-z0-9]+/g, '');
  // Common AON↔ripperoni field renames
  const aliases = {
    'recall_knowledge': ['recall_knowledge'],
    'ac_bonus': ['ac_bonus', 'ac'],
    'speed_penalty': ['speed_penalty'],
    'dex_cap': ['dex_cap'],
    'check_penalty': ['check_penalty'],
    'saving_throw': ['saving_throw', 'savingThrow', 'saves'],
    'primary_check': ['ritual_primary_check', 'primary_check'],
    'secondary_casters': ['ritual_secondary_casters'],
    'secondary_checks': ['ritual_secondary_checks'],
    'type': ['weapon_type', 'armor_type', 'kind', 'item_type', 'type'],
    'class_features': ['class_features', 'features'],
    'description': ['description_text', 'description_html', 'description'],
    'targets': ['targets'],
    'target_s_': ['targets'],
    'usage': ['usage'],
    'hands': ['hands'],
    'price': ['price'],
    'bulk': ['bulk'],
    'damage': ['damage'],
    'category': ['category', 'weapon_category'],
    'group': ['group', 'weapon_group'],
    'reload': ['reload'],
    'range': ['range'],
    'ammunition': ['ammunition'],
    'cast': ['cast'],
    'duration': ['duration'],
    'cost': ['cost'],
    'requirements': ['requirements'],
    'frequency': ['frequency'],
    'trigger': ['trigger'],
    'effect': ['effect'],
    'access': ['access'],
    'area': ['area'],
    'defense': ['defense'],
    'archetype': ['class_archetypes'],
    'archetypes': ['class_archetypes'],
    'prerequisites': ['prerequisites'],
    'traditions': ['traditions'],
    'tradition': ['traditions'],
    'bloodline': ['bloodlines'],
    'bloodlines': ['bloodlines'],
    'deity': ['deities'],
    'deities': ['deities'],
    'catalysts': ['catalysts'],
    'spell_list': ['spell_list'],
    'favored_weapon': ['favored_weapon'],
    'base_weapon': ['base_weapon'],
    'base_armor': ['base_armor'],
    'activate': ['activate', 'activation'],
    'strength': ['strength'],
    'complexity': ['complexity'],
    'stealth': ['stealth'],
    'level': ['level'],
    'hardness': ['hardness'],
    'hp_bt_': ['hp_bt', 'hp'],
    'hit_points': ['hp', 'hit_points'],
    'perception': ['perception'],
    'skills': ['skills'],
    'languages': ['languages'],
    'str': ['abilities'],
    'dex': ['abilities'],
    'con': ['abilities'],
    'int': ['abilities'],
    'wis': ['abilities'],
    'cha': ['abilities'],
    'items': ['items'],
    'elite': ['variants'],
    'normal': ['variants'],
    'weak': ['variants'],
    'proficiency_without_level': ['variants'],
    'melee': ['strikes'],
    'ranged': ['strikes'],
  };
  return [snake, compact, ...(aliases[snake] ?? [])];
}

for (const [, files] of byKind) {
  for (const f of files.slice(0, SAMPLE_N)) {
    const html = readFileSync(`${rawDir}/${f}`, 'utf8');
    const url = `https://2e.aonprd.com/${f.replace('.html', '').replace('-ID-', '.aspx?ID=')}`;
    let r;
    try { r = parseAonHtml(html, url); } catch { continue; }
    const t = r._type;
    counts.set(t, (counts.get(t) ?? 0) + 1);
    if (!orphans.has(t)) orphans.set(t, new Map());
    const topKeys = new Set(Object.keys(r).map((k) => k.toLowerCase()));
    const oMap = orphans.get(t);
    for (const rk of Object.keys(r.raw_fields ?? {})) {
      const cands = candidateKeys(rk);
      const matched = cands.some((c) => topKeys.has(c.toLowerCase()));
      if (!matched) {
        oMap.set(rk, (oMap.get(rk) ?? 0) + 1);
      }
    }
  }
}

console.log(`=== ORPHAN raw_fields keys (no structured equivalent) ===`);
console.log(`Per _type, sample size N, then top orphan keys by frequency.\n`);
const sortedTypes = [...orphans.entries()].sort((a, b) => (counts.get(b[0]) ?? 0) - (counts.get(a[0]) ?? 0));
for (const [type, keys] of sortedTypes) {
  if (keys.size === 0) {
    console.log(`[${type}] n=${counts.get(type)}  (no orphans)`);
    continue;
  }
  console.log(`\n[${type}] n=${counts.get(type)}`);
  const sorted = [...keys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  for (const [key, count] of sorted) {
    const pct = ((count / counts.get(type)) * 100).toFixed(0);
    console.log(`  ${pct.padStart(3)}%  ${count.toString().padStart(3)}  ${key}`);
  }
}
