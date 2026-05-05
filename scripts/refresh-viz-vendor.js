/**
 * @fileoverview Refresh the vendored cytoscape.js and cytoscape-fcose bundles.
 *
 * Usage:
 *   npm run viz:refresh-vendor
 *
 * Prerequisites:
 *   cytoscape must be installed as a devDependency:
 *   npm install --save-dev cytoscape
 *
 *   cytoscape-fcose must be installed (save-dev or no-save):
 *   npm install --save-dev cytoscape-fcose
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// cytoscape bundle
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// cytoscape-fcose bundle (combined with cose-base and layout-base)
// ---------------------------------------------------------------------------

const fcosePkgPath       = resolve(ROOT, 'node_modules', 'cytoscape-fcose', 'package.json');
const fcoseSrc           = resolve(ROOT, 'node_modules', 'cytoscape-fcose', 'cytoscape-fcose.js');
const coseBaseSrc        = resolve(ROOT, 'node_modules', 'cose-base', 'cose-base.js');
const layoutBaseSrc      = resolve(ROOT, 'node_modules', 'layout-base', 'layout-base.js');
const fcoseOutputDest    = resolve(ROOT, 'src', 'viz', 'vendor', 'cytoscapeFcoseBundle.ts');

let fcoseVersion = 'unknown';
try {
  const pkg = JSON.parse(readFileSync(fcosePkgPath, 'utf-8'));
  fcoseVersion = pkg.version ?? 'unknown';
} catch {
  console.warn('Warning: could not read cytoscape-fcose package.json for version.');
}

let fcoseContent, coseBaseContent, layoutBaseContent;
try {
  layoutBaseContent = readFileSync(layoutBaseSrc, 'utf-8');
  coseBaseContent   = readFileSync(coseBaseSrc, 'utf-8');
  fcoseContent      = readFileSync(fcoseSrc, 'utf-8');
} catch (err) {
  console.warn(`Warning: could not build fcose bundle: ${err.message}`);
  console.warn('Run: npm install --save-dev cytoscape-fcose (or npm install --no-save cytoscape-fcose)');
  process.exit(0);
}

/**
 * Wraps a UMD bundle source in a CommonJS-style IIFE that captures the
 * module.exports and satisfies the given require() map.
 */
function wrapUMD(src, requires) {
  const requireCases = Object.entries(requires)
    .map(([reqName, varName]) => `    if (id === '${reqName}') return ${varName};`)
    .join('\n');

  return `(function() {
  var module = { exports: {} };
  var exports = module.exports;
  var require = function(id) {
${requireCases}
    throw new Error('Unknown require: ' + id);
  };
  (function(){
${src}
  })();
  return module.exports;
})()`;
}

// Build the combined inline bundle: layout-base → cose-base → cytoscape-fcose.
// The final snippet calls cytoscape.use(cytoscapeFcose) so it self-registers
// on the global cytoscape instance when included after cytoscape.min.js.
const combinedBundle = `(function () {
  var layoutBase = ${wrapUMD(layoutBaseContent, {})};
  var coseBase = ${wrapUMD(coseBaseContent, { 'layout-base': 'layoutBase' })};
  var cytoscapeFcose = ${wrapUMD(fcoseContent, { 'cose-base': 'coseBase' })};
  if (typeof cytoscape !== 'undefined' && cytoscapeFcose) {
    cytoscape.use(cytoscapeFcose);
  }
})();
`;

// Escape for TypeScript template literal embedding.
const fcoseEscaped = combinedBundle
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${');

const fcoseOutput = `/* eslint-disable */
/**
 * @fileoverview Vendored cytoscape-fcose bundle as a string export.
 * Includes layout-base and cose-base as inline dependencies.
 * Inlined into rendered HTML after cytoscape bundle. Refresh via \`npm run viz:refresh-vendor\`.
 *
 * Source: https://github.com/iVis-at-Bilkent/cytoscape.js-fcose
 * License: MIT
 * Pinned version: ${fcoseVersion}
 */
// @ts-nocheck
export const CYTOSCAPE_FCOSE_BUNDLE: string = \`${fcoseEscaped}\`;
`;

writeFileSync(fcoseOutputDest, fcoseOutput, 'utf-8');
console.log(`Wrote cytoscape-fcose ${fcoseVersion} bundle to ${fcoseOutputDest}`);
console.log(`Bundle size: ${combinedBundle.length} bytes`);
