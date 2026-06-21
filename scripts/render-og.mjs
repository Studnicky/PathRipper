// render-og.mjs
//
// Render docs/public/og-image.svg to og-image.png (1200x630) for social-share
// unfurls. SVG-only cards fall back to a bare hostname on Discord / Slack /
// Twitter / LinkedIn; a raster PNG is required. Wired into docs:build via
// predocs:build. Skips gracefully when sharp is not installed.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname }                           from 'node:path';
import { fileURLToPath }                           from 'node:url';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'public');
const SRC  = join(PUBLIC_DIR, 'og-image.svg');
const OUT  = join(PUBLIC_DIR, 'og-image.png');

if (!existsSync(SRC)) {
  process.stdout.write('render-og: og-image.svg missing; skipping\n');
  process.exit(0);
}

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  process.stdout.write('render-og: sharp not installed; skipping PNG render\n');
  process.exit(0);
}

const png = await sharp(readFileSync(SRC), { density: 144 })
  .resize(1200, 630, { fit: 'cover' })
  .png({ compressionLevel: 9, palette: false })
  .toBuffer();
writeFileSync(OUT, png);
process.stdout.write(`render-og: wrote og-image.png (1200x630, ${png.length.toString()} bytes)\n`);
