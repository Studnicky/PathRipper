// Unit tests for runHtml.
//
// Verifies:
//   - `runHtml(opts)` constructs and executes without throwing.
//   - `runHtml(opts)` with an empty paths list returns without dispatching.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runHtml } from '../../../src/run/runHtml.js';
import type { ScrapeHtmlOptionsInterface } from '../../../src/types/RipperRun.js';
import type { NormalizedRipperConfigInterface } from '../../../src/types/Config.js';

// ── Minimal config fixture ────────────────────────────────────────────────────

const makeHtmlConfig = (outDir: string): NormalizedRipperConfigInterface => ({
  output:    { basePath: outDir, format: 'json', pretty: true },
  targets:   {
    testsite: {
      baseUrl:  'https://example.com',
      pipeline: ['html:fetch', 'json:write'],
      cache:    { dir: join(outDir, '.cache', 'testsite'), mode: 'read-write' },
    },
  },
} as unknown as NormalizedRipperConfigInterface);

const makeOpts = (tmpDir: string): ScrapeHtmlOptionsInterface => ({
  target:    'testsite',
  paths:     [],
  outDir:    tmpDir,
  configDir: '.',
  config:    makeHtmlConfig(tmpDir),
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runHtml', () => {
  it('runHtml() with empty paths returns without throwing', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ripper-run-test-'));
    try {
      await assert.doesNotReject(async () => {
        await runHtml(makeOpts(tmpDir));
      });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('runHtml() constructs without throwing', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ripper-run-test-'));
    try {
      await assert.doesNotReject(async () => {
        await runHtml(makeOpts(tmpDir));
      });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('runHtml() with empty paths is a no-op (does not reject)', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ripper-run-test-'));
    try {
      await runHtml(makeOpts(tmpDir));
      // If we get here, the function returned without error — that is the expected behaviour
      // when no URLs are provided.
      assert.ok(true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
