/**
 * Unit tests for MarkdownWriteNode.
 */
import { describe, it, before, after } from 'node:test';
import { mkdtemp, rm, readFile }       from 'node:fs/promises';
import { tmpdir }                      from 'node:os';
import { join }                        from 'node:path';
import assert                          from 'node:assert/strict';

import { Batch }              from '@studnicky/dagonizer';
import { NodeContextBuilder } from '@studnicky/dagonizer/entities';

import { ScrapeState }       from '../../../src/state/ScrapeState.js';
import { MarkdownWriteNode } from '../../../src/nodes/MarkdownWriteNode.js';
import type { RipperServices } from '../../../src/services/RipperServices.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const makeContext = (outDir: string): import('@studnicky/dagonizer').NodeContextType<RipperServices> =>
  NodeContextBuilder.of<RipperServices>(
    'test',
    'test',
    new AbortController().signal,
    {
      log: {
        debug: () => {},
        info:  () => {},
        warn:  () => {},
        error: () => {},
      } as unknown as RipperServices['log'],
      cache:      null,
      target:     { id: 'test-target' },
      outDir,
      dispatcher: {} as RipperServices['dispatcher'],
    } as unknown as RipperServices,
  );

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('MarkdownWriteNode', () => {
  let tmpDir = '';

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'markdown-write-test-'));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns success and writes .md file when state.page.html has content', async () => {
    const state      = new ScrapeState();
    state.page       = {
      targetId: 'test-target',
      title:    'Test Page',
      url:      'https://example.com/test-page',
      html:     '<html><body><h1>Hello</h1><p>World</p></body></html>',
    };

    const result = await MarkdownWriteNode.execute(Batch.of(state), makeContext(tmpDir));

    assert.ok(result.has('success'), `expected 'success', got ${[...result.keys()].join(', ')}`);

    const outFile = join(tmpDir, 'test-target', 'test-page.md');
    const content = await readFile(outFile, 'utf8');
    assert.ok(content.includes('# Hello'), `expected heading in output, got: ${content}`);
    assert.ok(content.includes('World'),   `expected paragraph in output, got: ${content}`);
  });

  it('returns skipped when state.page.html is empty string', async () => {
    const state  = new ScrapeState();
    state.page   = {
      targetId: 'test-target',
      title:    'Empty',
      url:      'https://example.com/empty',
      html:     '',
    };

    const result = await MarkdownWriteNode.execute(Batch.of(state), makeContext(tmpDir));

    assert.ok(result.has('skipped'), `expected 'skipped', got ${[...result.keys()].join(', ')}`);
  });

  it('returns skipped when state.page.html is undefined', async () => {
    const state  = new ScrapeState();
    state.page   = {
      targetId: 'test-target',
      title:    'No HTML',
      url:      'https://example.com/no-html',
    };

    const result = await MarkdownWriteNode.execute(Batch.of(state), makeContext(tmpDir));

    assert.ok(result.has('skipped'), `expected 'skipped', got ${[...result.keys()].join(', ')}`);
  });
});
