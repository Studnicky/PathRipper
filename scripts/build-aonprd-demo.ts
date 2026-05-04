/**
 * @fileoverview Build script for the Pathfinder/aonprd demo.
 *
 * @remarks
 * Produces both `docs/public/examples/aonprd/aonprd.jsonld` and
 * `docs/public/examples/aonprd/aonprd.html` — the checked-in demo files
 * served via VitePress public passthrough under /examples/aonprd/.
 *
 * Usage:
 *   npm run viz:demo
 *
 * @module scripts/build-aonprd-demo
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname }           from 'node:path';
import { fileURLToPath }              from 'node:url';

import { SquashageConfig }       from '../src/config/SquashageConfig.js';
import { SquashageOrchestrator } from '../src/orchestrators/SquashageOrchestrator.js';
import { registerAonprdPlugin }  from '../tests/e2e/aonprd/plugin.js';
import { JsonLdGraph }           from '../src/viz/JsonLdGraph.js';
import { GraphRenderer }         from '../src/viz/GraphRenderer.js';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const ROOT         = resolve(__dirname, '..');
const FIXTURE      = resolve(ROOT, 'tests', 'e2e', 'aonprd');
const OUT_DIR      = resolve(ROOT, 'docs', 'public', 'examples', 'aonprd');
const JSON_LD_PATH = resolve(OUT_DIR, 'aonprd.jsonld');
const HTML_PATH    = resolve(OUT_DIR, 'aonprd.html');
const TARGET       = 'aonprd';

async function main(): Promise<void> {
  console.log('Building aonprd demo...');

  // Register the aonprd squash task plugin.
  registerAonprdPlugin();

  // Ensure output directory exists.
  await mkdir(OUT_DIR, { recursive: true });

  // Load the fixture config.
  const cfgPath  = resolve(FIXTURE, 'squashage.config.json');
  const raw      = JSON.parse(await readFile(cfgPath, 'utf-8')) as Record<string, unknown>;

  const targets = raw['targets'] as Record<string, Record<string, unknown>>;

  // Override input/output paths to absolute paths.
  targets[TARGET]!['input'] = resolve(FIXTURE, 'input');
  (targets[TARGET]!['output'] as Record<string, string>)['path'] = JSON_LD_PATH;

  // Resolve schema paths to absolute paths (relative to the fixture dir).
  const classification = targets[TARGET]!['classification'] as Record<string, unknown> | undefined;
  if (classification !== undefined) {
    const schemas = classification['schemas'];
    if (Array.isArray(schemas)) {
      classification['schemas'] = schemas.map((s: unknown) => {
        if (s !== null && typeof s === 'object' && !Array.isArray(s)) {
          const schemaObj = s as Record<string, unknown>;
          if (typeof schemaObj['schemaPath'] === 'string') {
            return {
              ...schemaObj,
              schemaPath: resolve(FIXTURE, schemaObj['schemaPath']),
            };
          }
        }
        return s;
      });
    }
  }

  // Write modified config to a temp location so SquashageConfig can load it.
  const tmpCfgPath = resolve(OUT_DIR, '.squashage.config.tmp.json');
  await writeFile(tmpCfgPath, JSON.stringify(raw, null, 2), 'utf-8');

  let result;
  try {
    // Run the squashage pipeline.
    const config = SquashageConfig.loadFromFile(tmpCfgPath);
    result = await SquashageOrchestrator.run(config, TARGET, {
      outDir:      resolve(OUT_DIR, 'graphs'),
      configPath:  tmpCfgPath,
      outOverride: JSON_LD_PATH,
    });
  } finally {
    // Clean up temp config.
    const { rm } = await import('node:fs/promises');
    await rm(tmpCfgPath, { force: true });
  }

  console.log(`Pipeline: records=${result.recordCount} succeeded=${result.succeeded} failed=${result.failed} exit=${result.exitCode}`);

  // Read the produced JSON-LD and render the HTML.
  const jsonldText = await readFile(JSON_LD_PATH, 'utf-8');
  const doc        = JSON.parse(jsonldText) as unknown;
  const payload    = JsonLdGraph.fromCompactedJsonLd(doc);
  const html       = GraphRenderer.render(payload, {
    title: 'Squashage — Pathfinder/AONPRD Demo',
  });

  await writeFile(HTML_PATH, html, 'utf-8');

  const htmlBytes = Buffer.byteLength(html, 'utf-8');
  console.log(`JSON-LD: ${JSON_LD_PATH}`);
  console.log(`HTML:    ${HTML_PATH} (${htmlBytes} bytes)`);
  console.log('Done.');
}

main().catch((err: unknown) => {
  process.stderr.write(String(err instanceof Error ? err.stack ?? err.message : err) + '\n');
  process.exit(1);
});
