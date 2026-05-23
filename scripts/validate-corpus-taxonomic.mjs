// Corpus validation harness — Phase 6.4 Wave 3 / Wave 6 audit Wave 1.
//
// Reparses a committed corpus sample through the taxonomic pipeline and
// compares results against the Wave 5 baselines. The full 3GB live capture
// at output-live/ was deleted in Wave 7 M12; the sample at
// tests/regression/aonprd-corpus/ contains 5 records per concept type
// (75 total), each with its raw HTML.
//
// Two execution modes:
//   --mode direct (default) — invokes `parseAonHtmlTaxonomic(html, url)`.
//                              Iterates the leaf-chain serially in-process.
//   --mode dag              — dispatches via the registered `aonprdParseDAG`
//                              through a real `RipperDagonizer`. This is the
//                              path production uses; it exercises the full
//                              annotation graph and is the only way to detect
//                              DAG-vs-direct drift (Wave 6 audit B2).
//
// Usage:
//   node --import tsx scripts/validate-corpus-taxonomic.mjs [--sample N] [--mode direct|dag]
//
// Exit code: 0 if zero CRASH and zero REGRESSION; 1 otherwise.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Dagonizer } from '@noocodex/dagonizer';

import { parseAonHtmlTaxonomic } from '../plugins/aonprd/parse.taxonomic.ts';
import { ScrapeState }    from '../src/state/ScrapeState.ts';
import { TerminalNode }   from '../src/nodes/TerminalNode.ts';
import { TAXONOMY }       from '../plugins/aonprd/taxonomy/aonprd.ts';
import { aonprdParseDAG } from '../plugins/aonprd/parse.dag.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');

// ── Directories ───────────────────────────────────────────────────────────────

const PARSE_DIR = join(ROOT, 'tests', 'regression', 'aonprd-corpus', 'parse');
const RAW_DIR   = join(ROOT, 'tests', 'regression', 'aonprd-corpus', 'raw');

// ── CLI args ──────────────────────────────────────────────────────────────────

const args     = process.argv.slice(2);
const sampleN  = (() => {
  const idx = args.indexOf('--sample');
  if (idx === -1) return 5;
  const v = parseInt(args[idx + 1] ?? '5', 10);
  return Number.isFinite(v) && v > 0 ? v : 5;
})();
const mode = (() => {
  const idx = args.indexOf('--mode');
  if (idx === -1) return 'direct';
  const v = args[idx + 1];
  if (v !== 'direct' && v !== 'dag') {
    throw new Error(`--mode must be 'direct' or 'dag' (got: ${String(v)})`);
  }
  return v;
})();

// ── DAG mode bootstrap (one dispatcher reused across all records) ─────────────

function buildDispatcher() {
  const dispatcher = new Dagonizer({ services: {} });
  dispatcher.registerNode(TerminalNode);
  for (const node of TAXONOMY.allNodes()) {
    dispatcher.registerNode(node);
  }
  dispatcher.registerDAG(aonprdParseDAG);
  return dispatcher;
}

const dispatcher = mode === 'dag' ? buildDispatcher() : null;

async function parseViaDag(html, url) {
  const state = new ScrapeState();
  state.page = { targetId: 'aonprd', title: '', url, html };
  await dispatcher.execute('aonprd:parse', state);
  return state.output ?? { _type: 'unknown', url };
}

async function parseOne(html, url) {
  return mode === 'dag' ? parseViaDag(html, url) : parseAonHtmlTaxonomic(html, url);
}

// ── Known field deprecations ──────────────────────────────────────────────────
//
// These baseline fields were intentionally dropped by the new taxonomy shape.
// They are NOT regressions — they are deliberate removals documented here.
//
// Key: baseline _type  Value: set of deprecated field names

const DEPRECATED_FIELDS = {
  language: new Set(['typical_speakers']),
  // Generic baseline records gain a typed _type in the new pipeline;
  // the baseline's `level` and `level_kind` are generic-only scalars.
  generic:  new Set(['level', 'level_kind']),
  // Wave 6 M4: generic `entity_id` aliases replaced by concept-specific
  // `<concept>_id` (e.g. `ancestry_id`, `condition_id`). The new
  // concept-specific field is reported as an IMPROVEMENT.
  ancestry:         new Set(['entity_id']),
  background:       new Set(['entity_id']),
  class:            new Set(['entity_id']),
  condition:        new Set(['entity_id']),
  hazard:           new Set(['entity_id']),
  trait:            new Set(['entity_id']),
  rule:             new Set(['entity_id']),
  curse:            new Set(['entity_id']),
  disease:          new Set(['entity_id']),
  'weather-hazard': new Set(['entity_id']),
  'monster-family': new Set(['entity_id']),
  'subclass-feature': new Set(['entity_id']),
};

// ── Known _type promotions ────────────────────────────────────────────────────
//
// Baseline _type → new taxonomy _type for pages that were previously generic.
// When the baseline _type is 'generic' or 'unknown', the new pipeline may
// produce a specific typed output. This is an IMPROVEMENT, not a regression.
//
// We validate identity fields (name, source.book) but do NOT flag _type
// mismatch when baseline is generic/unknown.
//
// url-path → new _type (mirrors AONPRD_TAXONOMY urlPaths)

const URL_PATH_TO_EXPECTED_TYPE = new Map([
  ['languages',         'language'],
  ['planes',            'plane'],
  ['contributors',      'contributor'],
  ['weapongroups',      'weapon-group'],
  ['armorgroups',       'armor-group'],
  ['articles',          'article'],
  ['conditions',        'condition'],
  ['traits',            'trait'],
  ['actions',           'action'],
  ['activities',        'action'],
  ['hazards',           'hazard'],
  ['weatherhazards',    'weather-hazard'],
  ['weapons',           'weapon'],
  ['armor',             'armor'],
  ['equipment',         'equipment'],
  ['relics',            'relic'],
  ['setrelics',         'set-relic'],
  ['siegeweapons',      'siege-weapon'],
  ['vehicles',          'vehicle'],
  ['familiars',         'familiar'],
  ['monsters',          'monster'],
  ['creatures',         'monster'],
  ['npcs',              'monster'],
  ['companions',        'animal-companion'],
  ['monsterabilities',  'monster-ability'],
  ['monstertemplates',  'monster-template'],
  ['monsterfamilies',   'monster-family'],
  ['curses',            'curse'],
  ['diseases',          'disease'],
  ['domains',           'domain'],
  ['sources',           'source'],
  ['ancestries',        'ancestry'],
  ['backgrounds',       'background'],
  ['classes',           'class'],
  ['classsamples',      'class-sample'],
  ['classkits',         'class-kit'],
  ['npcthemetemplates', 'npc-theme-template'],
  ['feats',             'feat'],
  ['mythicfeats',       'feat'],
  ['skills',            'skill'],
  ['archetypes',        'archetype'],
  // subclass-feature paths
  ['bloodlines',         'subclass-feature'],
  ['mysteries',          'subclass-feature'],
  ['patrons',            'subclass-feature'],
  ['lessons',            'subclass-feature'],
  ['apparitions',        'subclass-feature'],
  ['causes',             'subclass-feature'],
  ['eidolons',           'subclass-feature'],
  ['researchfields',     'subclass-feature'],
  ['hybridstudies',      'subclass-feature'],
  ['methodologies',      'subclass-feature'],
  ['muses',              'subclass-feature'],
  ['ways',               'subclass-feature'],
  ['huntersedge',        'subclass-feature'],
  ['implements',         'subclass-feature'],
  ['consciousminds',     'subclass-feature'],
  ['subconsciousminds',  'subclass-feature'],
  ['rackets',            'subclass-feature'],
  ['druidicorders',      'subclass-feature'],
  ['instincts',          'subclass-feature'],
  ['styles',             'subclass-feature'],
  ['arcaneschools',      'subclass-feature'],
  ['arcanethesis',       'subclass-feature'],
  ['mythicdestinies',    'subclass-feature'],
  ['ikons',              'subclass-feature'],
  ['epithets',           'subclass-feature'],
  ['deviantfeats',       'subclass-feature'],
  ['heritages',          'subclass-feature'],
  ['elements',           'subclass-feature'],
  ['followers',          'subclass-feature'],
  ['practices',          'subclass-feature'],
  ['hellknightorders',   'subclass-feature'],
  ['doctrines',          'subclass-feature'],
  ['tenets',             'subclass-feature'],
  ['innovations',        'subclass-feature'],
  // spell family
  ['spells',             'spell'],
  ['mythicspells',       'spell'],
  ['rituals',            'ritual'],
  ['mythicrituals',      'ritual'],
  // deity family
  ['deities',            'deity'],
  ['deitycategories',    'deity-category'],
  // rule
  ['rules',              'rule'],
  // kingmaker
  ['kmstructures',       'km-structure'],
  ['kmevents',           'km-event'],
  ['tactics',            'tactic'],
  ['campmeals',          'camp-meal'],
  ['campactivities',     'camp-activity'],
  ['kmwartactics',       'km-war-tactic'],
  ['kmwararmies',        'km-war-army'],
]);

// ── Filename → URL ─────────────────────────────────────────────────────────────

/**
 * Derive the canonical AON URL from a parse-output filename.
 * Pattern: `Languages.aspx-ID-170.json` → `https://2e.aonprd.com/Languages.aspx?ID=170`
 * Extra suffixes like `-NoRedirect-1`, `-Elite-true` are stripped.
 */
function filenameToUrl(filename) {
  const m = /^([A-Za-z]+)\.aspx-ID-(\d+).*\.json$/.exec(filename);
  if (m === null) return null;
  return `https://2e.aonprd.com/${m[1]}.aspx?ID=${m[2]}`;
}

/**
 * Extract the lowercase URL path from a canonical AON URL.
 * e.g. `https://2e.aonprd.com/Languages.aspx?ID=170` → `languages`
 */
function extractUrlPath(url) {
  const m = /\/([A-Za-z]+)\.aspx/i.exec(url);
  return m !== null ? m[1].toLowerCase() : null;
}

/**
 * Derive the raw HTML filename from the JSON parse-output filename.
 * Same base name, `.json` → `.html`.
 */
function jsonToHtmlFilename(jsonFilename) {
  return jsonFilename.replace(/\.json$/, '.html');
}

// ── Sampling ──────────────────────────────────────────────────────────────────

/**
 * Load all parse-output JSON files, group by their _type, and sample up to N
 * per group. Returns a Map from _type → array of { filename, baseline } pairs.
 */
function buildSample(n) {
  const allFiles = readdirSync(PARSE_DIR).filter((f) => f.endsWith('.json'));

  // Group files by their baseline _type
  const byType = new Map();

  for (const f of allFiles) {
    let baseline;
    try {
      baseline = JSON.parse(readFileSync(join(PARSE_DIR, f), 'utf8'));
    } catch {
      continue;
    }
    const t = baseline._type ?? 'MISSING';
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push({ filename: f, baseline });
  }

  // Sample N per type (stable ordering — first N by filename)
  const sample = new Map();
  for (const [type, records] of byType) {
    sample.set(type, records.slice(0, n));
  }
  return sample;
}

// ── Comparison ────────────────────────────────────────────────────────────────

/**
 * Compare a new parse result against the baseline for a single record.
 * Returns an array of delta objects categorised as REGRESSION or IMPROVEMENT.
 *
 * For baseline types 'unknown' and 'generic': the baseline shape is a Wave 5
 * fallback shape (empty fields). The new pipeline promotes these to typed
 * concepts. We only check that the new output has a non-crash _type; all
 * typed promotions are counted as improvements, not regressions.
 *
 * For typed baseline records (monster, feat, spell, etc.): full checks apply.
 */
function compareOutputs(baseline, newOutput, baselineType) {
  const deltas = [];
  const deprecations = DEPRECATED_FIELDS[baselineType] ?? new Set();

  // For unknown/generic baselines — fallback shapes, not meaningful targets.
  // Only check for improvement (type promotion). Skip superset/identity checks.
  const isFallbackBaseline = baselineType === 'unknown' || baselineType === 'generic';

  if (isFallbackBaseline) {
    // If the new output has a more specific type, count as improvement
    if (newOutput._type !== baselineType) {
      deltas.push({
        kind:           'IMPROVEMENT',
        field:          '_type',
        baseline_value: baselineType,
        new_value:      newOutput._type,
        reason:         `promoted from ${baselineType} to ${newOutput._type}`,
      });
    }
    return deltas;
  }

  // ── Typed baseline checks ─────────────────────────────────────────────────

  // Scalar identity checks.
  // NOTE: 'url' is intentionally excluded — the harness derives a simplified
  // URL (stripping crawl params like NoRedirect=1) while the baseline stores
  // the actual crawl URL. These legitimately differ and are not regressions.
  // NOTE: 'name' comparison only makes sense when the baseline name is non-empty.
  const identityChecks = ['name'];
  for (const field of identityChecks) {
    const bv = baseline[field];
    const nv = newOutput[field];
    // Only check if baseline has a non-empty value (empty baseline name = stub page)
    if (bv !== undefined && bv !== '' && nv === undefined) {
      if (!deprecations.has(field)) {
        deltas.push({ kind: 'REGRESSION', field, baseline_value: bv, new_value: null, reason: 'field missing in new output' });
      }
    } else if (bv !== undefined && bv !== '' && nv !== undefined && typeof bv === 'string' && typeof nv === 'string' && bv !== nv) {
      deltas.push({ kind: 'REGRESSION', field, baseline_value: bv, new_value: nv, reason: 'value mismatch' });
    }
  }

  // source.book check
  if (baseline.source !== undefined && typeof baseline.source === 'object' && baseline.source.book !== null) {
    if (newOutput.source === undefined || newOutput.source === null) {
      deltas.push({ kind: 'REGRESSION', field: 'source.book', baseline_value: baseline.source.book, new_value: null, reason: 'source object missing' });
    } else if (newOutput.source.book !== baseline.source.book) {
      deltas.push({ kind: 'REGRESSION', field: 'source.book', baseline_value: baseline.source.book, new_value: newOutput.source.book, reason: 'source.book mismatch' });
    }
  }

  // Present-key superset check (every top-level key in baseline must be present
  // in new output, modulo known deprecations).
  // Skip the _type and url keys since type promotions and URL param differences
  // are expected.
  const EXCLUDED_FROM_SUPERSET = new Set(['_type', 'url']);
  const baselineKeys = Object.keys(baseline).filter(
    (k) => !EXCLUDED_FROM_SUPERSET.has(k) && !deprecations.has(k),
  );
  const newKeys = new Set(Object.keys(newOutput));

  for (const key of baselineKeys) {
    if (!newKeys.has(key)) {
      deltas.push({ kind: 'REGRESSION', field: key, baseline_value: String(baseline[key]).slice(0, 80), new_value: null, reason: 'top-level key absent from new output' });
    }
  }

  // Improvement check: new keys not in baseline (excluding internal metadata)
  const INTERNAL_KEYS = new Set(['_type', 'url']);
  const baselineKeySet = new Set(Object.keys(baseline));
  for (const key of newKeys) {
    if (!baselineKeySet.has(key) && !INTERNAL_KEYS.has(key)) {
      deltas.push({ kind: 'IMPROVEMENT', field: key, baseline_value: null, new_value: '(present)', reason: 'new field not in baseline' });
    }
  }

  return deltas;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Corpus validation — taxonomic pipeline (Phase 6.4 Wave 3 / Wave 6 audit Wave 1)`);
  console.log(`Mode:      ${mode}`);
  console.log(`Sample:    ${sampleN} records per baseline _type`);
  console.log(`Parse dir: ${PARSE_DIR}`);
  console.log(`Raw dir:   ${RAW_DIR}`);
  console.log('');

  const sample = buildSample(sampleN);

  // Per-concept tallies
  const conceptResults = new Map(); // conceptKey → { pass, regression, improvement, crash, total }

  let totalSampled    = 0;
  let totalCrash      = 0;
  let totalRegression = 0;
  let totalImprovement = 0;

  const allCrashes     = [];
  const allRegressions = [];
  const allImprovements = [];

  for (const [baselineType, records] of sample) {
    const tally = { pass: 0, regression: 0, improvement: 0, crash: 0, total: 0 };
    conceptResults.set(baselineType, tally);

    for (const { filename, baseline } of records) {
      tally.total++;
      totalSampled++;

      const url = filenameToUrl(filename);
      if (url === null) {
        tally.crash++;
        totalCrash++;
        allCrashes.push({ baseline_type: baselineType, filename, url: null, error: 'cannot derive URL from filename' });
        continue;
      }

      const htmlFilename = jsonToHtmlFilename(filename);
      const htmlPath     = join(RAW_DIR, htmlFilename);

      let html;
      try {
        html = readFileSync(htmlPath, 'utf8');
      } catch {
        // No raw HTML — skip with a warning (not a regression, not a crash)
        console.warn(`  SKIP no HTML: ${filename}`);
        tally.total--;
        totalSampled--;
        continue;
      }

      // Determine expected _type from URL path
      const urlPath     = extractUrlPath(url);
      const expectedType = urlPath !== null ? (URL_PATH_TO_EXPECTED_TYPE.get(urlPath) ?? null) : null;

      // Run the new taxonomic pipeline (direct-call or DAG dispatch).
      let newOutput;
      try {
        newOutput = await parseOne(html, url);
      } catch (err) {
        tally.crash++;
        totalCrash++;
        allCrashes.push({ baseline_type: baselineType, filename, url, error: String(err) });
        continue;
      }

      // Check for 'unknown' result when a specific type is expected.
      // When the baseline ITSELF is 'unknown', allow the new output to also
      // be 'unknown' — some pages genuinely have no parseable content (deleted
      // entries, stub pages). These are not regressions or crashes.
      if (newOutput._type === 'unknown' && expectedType !== null && baselineType !== 'unknown') {
        tally.crash++;
        totalCrash++;
        allCrashes.push({
          baseline_type: baselineType,
          filename,
          url,
          error: `returned _type 'unknown' but expected '${expectedType}' (url_path: ${urlPath ?? '?'})`,
        });
        continue;
      }

      // When both baseline and new output are 'unknown', count as pass
      // (both pipelines agree the page has no parseable content).
      if (baselineType === 'unknown' && newOutput._type === 'unknown') {
        tally.pass++;
        continue;
      }

      // Compare outputs
      const deltas = compareOutputs(baseline, newOutput, baselineType);

      let recordReg = 0;
      let recordImp = 0;

      for (const delta of deltas) {
        if (delta.kind === 'REGRESSION') {
          tally.regression++;
          totalRegression++;
          recordReg++;
          allRegressions.push({ baseline_type: baselineType, filename, url, ...delta });
        } else if (delta.kind === 'IMPROVEMENT') {
          recordImp++;
          totalImprovement++;
          allImprovements.push({ baseline_type: baselineType, filename, url, ...delta });
        }
      }

      if (recordReg === 0) {
        tally.pass++;
      }
      if (recordImp > 0) {
        tally.improvement++;
      }
    }
  }

  // ── Report ─────────────────────────────────────────────────────────────────

  console.log('=== PER-CONCEPT RESULTS ===');
  console.log('');

  const columnWidths = { type: 22, total: 6, pass: 6, regression: 12, improvement: 13, crash: 8 };
  const header = [
    'BASELINE _TYPE'.padEnd(columnWidths.type),
    'TOTAL'.padStart(columnWidths.total),
    'PASS'.padStart(columnWidths.pass),
    'REGRESSION'.padStart(columnWidths.regression),
    'IMPROVEMENT'.padStart(columnWidths.improvement),
    'CRASH'.padStart(columnWidths.crash),
  ].join('  ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const [type, tally] of [...conceptResults.entries()].sort()) {
    const row = [
      type.padEnd(columnWidths.type),
      String(tally.total).padStart(columnWidths.total),
      String(tally.pass).padStart(columnWidths.pass),
      String(tally.regression).padStart(columnWidths.regression),
      String(tally.improvement).padStart(columnWidths.improvement),
      String(tally.crash).padStart(columnWidths.crash),
    ].join('  ');
    const marker = tally.crash > 0 ? '  [CRASH]' : tally.regression > 0 ? '  [REGRESSION]' : '';
    console.log(row + marker);
  }

  console.log('-'.repeat(header.length));
  const totalRow = [
    'TOTAL'.padEnd(columnWidths.type),
    String(totalSampled).padStart(columnWidths.total),
    String(totalSampled - totalCrash - totalRegression).padStart(columnWidths.pass),
    String(totalRegression).padStart(columnWidths.regression),
    String(totalImprovement).padStart(columnWidths.improvement),
    String(totalCrash).padStart(columnWidths.crash),
  ].join('  ');
  console.log(totalRow);
  console.log('');

  // ── Crashes ───────────────────────────────────────────────────────────────

  if (allCrashes.length > 0) {
    console.log('=== CRASHES ===');
    console.log('');
    for (const c of allCrashes) {
      console.log(`[CRASH] baseline_type=${c.baseline_type}`);
      console.log(`        file: ${c.filename}`);
      console.log(`        url:  ${c.url ?? '?'}`);
      console.log(`        error: ${c.error}`);
      console.log('');
    }
  }

  // ── Regressions ───────────────────────────────────────────────────────────

  if (allRegressions.length > 0) {
    console.log('=== REGRESSIONS ===');
    console.log('');
    for (const r of allRegressions) {
      console.log(`[REGRESSION] baseline_type=${r.baseline_type}  field=${r.field}`);
      console.log(`             file: ${r.filename}`);
      console.log(`             url:  ${r.url}`);
      console.log(`             baseline: ${String(r.baseline_value).slice(0, 100)}`);
      console.log(`             new:      ${String(r.new_value).slice(0, 100)}`);
      console.log(`             reason:   ${r.reason}`);
      console.log('');
    }
  }

  // ── Improvements ─────────────────────────────────────────────────────────

  if (allImprovements.length > 0) {
    console.log('=== IMPROVEMENTS ===');
    console.log('');
    // Group improvements by concept × field
    const grouped = new Map();
    for (const imp of allImprovements) {
      const key = `${imp.baseline_type}/${imp.field}`;
      if (!grouped.has(key)) grouped.set(key, { ...imp, count: 0 });
      grouped.get(key).count++;
    }
    for (const [key, imp] of grouped) {
      console.log(`[IMPROVEMENT] ${key}  (${imp.count}x)`);
      console.log(`              reason: ${imp.reason}`);
    }
    console.log('');
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('=== SUMMARY ===');
  console.log('');
  console.log(`Total sampled:   ${totalSampled}`);
  console.log(`Crashes:         ${totalCrash}`);
  console.log(`Regressions:     ${totalRegression}`);
  console.log(`Improvements:    ${allImprovements.length}`);
  console.log('');

  if (totalCrash === 0 && totalRegression === 0) {
    console.log('Result: PASS — zero CRASH, zero REGRESSION');
    process.exit(0);
  } else {
    console.log(`Result: FAIL — ${totalCrash} CRASH, ${totalRegression} REGRESSION`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
