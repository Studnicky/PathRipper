/**
 * Re-parse all cached AONPRD HTML pages with the current aonprd plugin.
 * Writes JSON outputs to output/aonprd/aonprd/<filename>.json for the
 * Squashage v0.6.0 demo corpus.
 *
 * No network. Reads only from the cache.
 *
 * Usage:
 *   node --import tsx scripts/reparse-cache.ts
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAonHtml } from '../plugins/aonprd/parse.task.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const ROOT       = resolve(__dirname, '..');
const CACHE_DIR  = resolve(ROOT, 'output/.cache/aonprd');
const OUT_DIR    = resolve(ROOT, 'output/aonprd/aonprd');

interface MetaInterface {
  url:      string;
  bodyPath: string;
  status:   number;
  size:     number;
}

function deriveFilename(url: string): string {
  const u = new URL(url);
  const path   = u.pathname.replace(/^\//, '');
  const search = u.search.replace(/^\?/, '');
  const combined = search.length > 0 ? `${path}?${search}` : path;
  return combined
    .replace(/[\/?=&#]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  const shards = (await readdir(CACHE_DIR, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && e.name !== 'bodies')
    .map((e) => e.name);

  let processed = 0;
  let parsed    = 0;
  let skipped   = 0;
  let errored   = 0;

  for (const shard of shards) {
    const shardDir = resolve(CACHE_DIR, shard);
    const files    = await readdir(shardDir);
    for (const f of files) {
      if (!f.endsWith('.meta.json')) continue;
      processed += 1;

      try {
        const metaRaw = await readFile(resolve(shardDir, f), 'utf-8');
        const meta    = JSON.parse(metaRaw) as MetaInterface;
        if (meta.status !== 200) { skipped += 1; continue; }
        if (!meta.url.includes('?ID=')) { skipped += 1; continue; }

        const html = await readFile(meta.bodyPath, 'utf-8');
        const result = parseAonHtml(html, meta.url) as { _type: string };
        if (result._type === 'unknown') { skipped += 1; continue; }

        const filename = deriveFilename(meta.url);
        const outPath  = resolve(OUT_DIR, `${filename}.json`);
        await writeFile(outPath, JSON.stringify(result, null, 2));
        parsed += 1;
      } catch (err) {
        errored += 1;
        if (errored < 5) {
          process.stderr.write(`error parsing ${f}: ${(err as Error).message}\n`);
        }
      }

      if (processed % 1000 === 0) {
        process.stdout.write(`  processed ${processed} / parsed ${parsed} / skipped ${skipped} / errored ${errored}\n`);
      }
    }
  }

  process.stdout.write(`\nDone: processed=${processed} parsed=${parsed} skipped=${skipped} errored=${errored}\n`);
  process.stdout.write(`Output: ${OUT_DIR}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`fatal: ${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
