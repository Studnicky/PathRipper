/**
 * @fileoverview Refresh the vendored cytoscape.js bundle.
 *
 * Usage:
 *   npm run viz:refresh-vendor
 *
 * Prerequisites:
 *   cytoscape must be installed as a devDependency:
 *   npm install --save-dev cytoscape
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const bundleSrc  = resolve(ROOT, 'node_modules', 'cytoscape', 'dist', 'cytoscape.min.js');
const outputDest = resolve(ROOT, 'src', 'viz', 'vendor', 'cytoscapeBundle.ts');
const pkgJson    = resolve(ROOT, 'node_modules', 'cytoscape', 'package.json');

let version = 'unknown';
try {
  const pkg = JSON.parse(readFileSync(pkgJson, 'utf-8'));
  version = pkg.version ?? 'unknown';
} catch {
  console.error('Warning: could not read cytoscape package.json for version.');
}

let content;
try {
  content = readFileSync(bundleSrc, 'utf-8');
} catch (err) {
  console.error(`Error reading ${bundleSrc}: ${err.message}`);
  console.error('Run: npm install --save-dev cytoscape');
  process.exit(1);
}

// Escape for embedding in a TypeScript template literal.
// Backticks and backslashes must be escaped; ${ sequences must be escaped.
const escaped = content
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${');

const output = `/* eslint-disable */
/**
 * @fileoverview Vendored cytoscape.js minified bundle as a string export.
 * Inlined into rendered HTML. Refresh via \`npm run viz:refresh-vendor\`.
 *
 * Source: https://github.com/cytoscape/cytoscape.js
 * License: MIT
 * Pinned version: ${version}
 */
// @ts-nocheck
export const CYTOSCAPE_JS_BUNDLE: string = \`${escaped}\`;
`;

writeFileSync(outputDest, output, 'utf-8');
console.log(`Wrote cytoscape ${version} bundle to ${outputDest}`);
console.log(`Bundle size: ${content.length} bytes`);
