// copy-dag-assets.mjs
//
// `tsc` emits only `.js`/`.d.ts`; it never copies non-TS assets. Runtime loaders
// read authored `.dag.jsonld` documents by a path relative to the COMPILED module
// (e.g. `PluginLoader` loads `../crawlers/crawl-discover.dag.jsonld` via
// `import.meta.dirname`). Two compiled trees exist and both need the assets:
//
//   • `dist/`         — the main CLI build (`tsc`, rootDir `src`). It loads only
//                       the builtin `src/` assets; plugin documents are read from
//                       the source `plugins/` tree at run time, never from dist/.
//   • `dist-workers/` — the worker-thread build (`tsconfig.workers.json`, rootDir
//                       `.`). Each `WorkerThreadContainer` boots a `DagHost` that
//                       re-runs `PluginLoader` inside the worker, resolving asset
//                       paths under `dist-workers/`. It therefore needs BOTH the
//                       `src/` builtin assets and the `plugins/` documents.
//
// Wired into `npm run build` after the `tsc`/worker compiles.

import { cpSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative }                              from 'node:path';

// Each target: the roots to scan, and how a source path maps to its dest.
const targets = [
  // Main CLI build: src/<p>.dag.jsonld → dist/<p>.dag.jsonld.
  { dist: 'dist',         roots: ['src'],            rebase: (path, root) => join('dist', relative(root, path)) },
  // Worker build: rootDir is the repo root, so the full path is preserved
  // (src/<p> → dist-workers/src/<p>, plugins/<p> → dist-workers/plugins/<p>).
  { dist: 'dist-workers', roots: ['src', 'plugins'], rebase: (path)       => join('dist-workers', path) },
];

let copied = 0;
for (const target of targets) {
  if (!existsSync(target.dist)) continue;
  for (const root of target.roots) {
    const stack = [root];
    while (stack.length > 0) {
      const dir = stack.pop();
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          stack.push(path);
        } else if (name.endsWith('.dag.jsonld')) {
          const dest = target.rebase(path, root);
          mkdirSync(dirname(dest), { recursive: true });
          cpSync(path, dest);
          copied += 1;
          process.stdout.write(`  copied ${dest}\n`);
        }
      }
    }
  }
}
process.stdout.write(`Copied ${copied.toString()} .dag.jsonld asset(s) into dist/ + dist-workers/\n`);
