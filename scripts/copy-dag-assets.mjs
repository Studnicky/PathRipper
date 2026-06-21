// copy-dag-assets.mjs
//
// `tsc` emits only `.js`/`.d.ts`; it never copies non-TS assets. Runtime loaders
// read authored `.dag.jsonld` documents by a path relative to the COMPILED module
// (e.g. `PluginLoader` loads `../crawlers/crawl-discover.dag.jsonld` via
// `import.meta.dirname`, which resolves under `dist/` at runtime). Mirror every
// authored `.dag.jsonld` under `src/` into the matching `dist/` location so the
// built CLI finds them. Wired into `npm run build` after `tsc`.

import { cpSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative }                  from 'node:path';

const SRC  = 'src';
const DIST = 'dist';

const stack = [SRC];
let copied = 0;
while (stack.length > 0) {
  const dir = stack.pop();
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      stack.push(path);
    } else if (name.endsWith('.dag.jsonld')) {
      const dest = join(DIST, relative(SRC, path));
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(path, dest);
      copied += 1;
      process.stdout.write(`  copied ${dest}\n`);
    }
  }
}
process.stdout.write(`Copied ${copied.toString()} .dag.jsonld asset(s) into ${DIST}/\n`);
