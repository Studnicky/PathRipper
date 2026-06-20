import { describe, it, before, after } from 'node:test';
import { Batch } from '@studnicky/dagonizer';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LoadConfigNode } from '../../../../src/nodes/cli/LoadConfigNode.js';
import { CliState }       from '../../../../src/state/CliState.js';
import { Logger }         from '../../../../src/modules/logger/logger.js';

let tmpDir = '';

const makeContext = () => ({
  signal:   new AbortController().signal,
  dagName:  'cliScrapeDAG',
  nodeName: 'cli:load-config',
  services: { log: Logger.forComponent('LoadConfigNode.test') },
});

const MINIMAL_CONFIG = JSON.stringify({
  output: { basePath: './output', format: 'json', pretty: true },
  targets: {
    mysite: {
      baseUrl:  'https://example.com',
      pipeline: ['html:fetch', 'json:write'],
      cache:    { dir: './output/.cache/mysite', mode: 'read-write' },
    },
  },
});

describe('LoadConfigNode', () => {
  before(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'ripper-cli-loadcfg-')); });
  after(async ()  => { await rm(tmpDir, { recursive: true, force: true }); });

  it('returns success and populates state.config when the file is valid', async () => {
    const configPath = join(tmpDir, 'valid.config.json');
    await writeFile(configPath, MINIMAL_CONFIG, 'utf-8');

    const state = new CliState();
    state.configPath = configPath;
    state.outDir     = '';

    const result = await LoadConfigNode.execute(Batch.of(state), makeContext());

    assert.ok(result.has('success'));
    assert.notEqual(state.config, null);
    assert.equal(state.config?.output.basePath, './output');
    assert.equal(state.errorMessage, '');
  });

  it('resolves outDir from config when state.outDir is empty', async () => {
    const configPath = join(tmpDir, 'outdir.config.json');
    await writeFile(configPath, MINIMAL_CONFIG, 'utf-8');

    const state = new CliState();
    state.configPath = configPath;
    state.outDir     = '';

    await LoadConfigNode.execute(Batch.of(state), makeContext());

    assert.equal(state.outDir, './output');
  });

  it('preserves state.outDir when already set (--out flag override)', async () => {
    const configPath = join(tmpDir, 'override.config.json');
    await writeFile(configPath, MINIMAL_CONFIG, 'utf-8');

    const state = new CliState();
    state.configPath = configPath;
    state.outDir     = '/custom/out';

    await LoadConfigNode.execute(Batch.of(state), makeContext());

    assert.equal(state.outDir, '/custom/out');
  });

  it('returns error and sets errorMessage when file does not exist', async () => {
    const state = new CliState();
    state.configPath = join(tmpDir, 'does-not-exist.json');

    const result = await LoadConfigNode.execute(Batch.of(state), makeContext());

    assert.ok(result.has('error'));
    assert.equal(state.config, null);
    assert.ok(state.errorMessage.length > 0);
  });

  it('returns error and sets errorMessage for invalid JSON config', async () => {
    const configPath = join(tmpDir, 'bad.config.json');
    await writeFile(configPath, 'not json', 'utf-8');

    const state = new CliState();
    state.configPath = configPath;

    const result = await LoadConfigNode.execute(Batch.of(state), makeContext());

    assert.ok(result.has('error'));
    assert.equal(state.config, null);
    assert.ok(state.errorMessage.length > 0);
  });
});
