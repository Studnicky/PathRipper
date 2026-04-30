import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { WikiPageInterface, CategoryMemberInterface } from '../../../src/types/MediaWikiScraper.js';
import type { RunPipelineOptionsInterface } from '../../../src/types/ScrapeOrchestrator.js';
import type { FetchPagesBatchResult } from '../../../src/types/Results.js';
import { Logger } from '../../../src/modules/logger/logger.js';

/**
 * Minimal scraper stub — only fetchPagesBatch is used by runPipeline.
 * Records which title batches were requested so tests can assert on skips.
 */
class StubScraper {
  public readonly fetched: string[] = [];
  public readonly pages:   Map<string, string>;

  public constructor(pages: Map<string, string>) {
    this.pages = pages;
  }

  public async fetchPagesBatch(titles: string[]): FetchPagesBatchResult {
    for (const t of titles) this.fetched.push(t);
    return titles.map((t: string): WikiPageInterface => ({ title: t, wikitext: this.pages.get(t) ?? '' }));
  }
}

/** Access the private static runPipeline via a type cast for unit testing. */
async function invokeRunPipeline(opts: RunPipelineOptionsInterface): Promise<void> {
  type OrchestratorInternal = {
    runPipeline(opts: RunPipelineOptionsInterface): Promise<void>;
  };
  const { ScrapeOrchestrator } = await import('../../../src/orchestrators/ScrapeOrchestrator.js');
  await (ScrapeOrchestrator as unknown as OrchestratorInternal).runPipeline(opts);
}

describe('ScrapeOrchestrator', () => {
  it('skips pages whose slug file already exists in the output directory', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'ripperoni-orch-'));
    try {
      const targetId = 'wiki';
      const targetDir = resolve(tmpDir, targetId);

      // Pre-write the output dir with an existing slug for "Goblin"
      const { mkdir } = await import('node:fs/promises');
      await mkdir(targetDir, { recursive: true });
      const existingContent = JSON.stringify({ title: 'Goblin', wikitext: 'pre-existing' }, null, 2);
      await writeFile(join(targetDir, 'goblin.json'), existingContent);

      // Capture the mtime before the pipeline run
      const beforeStat = await stat(join(targetDir, 'goblin.json'));

      const members: CategoryMemberInterface[] = [
        { title: 'Goblin', pageid: 1 },   // already written — should be skipped
        { title: 'Orc',    pageid: 2 },   // not yet written — should be fetched
      ];

      const pages = new Map<string, string>([
        ['Goblin', 'goblin wikitext'],
        ['Orc',    'orc wikitext'],
      ]);
      const stub    = new StubScraper(pages);
      const log     = Logger.forComponent('test');

      await invokeRunPipeline({
        targetId,
        outDir:         tmpDir,
        scraper:        stub as unknown as Parameters<typeof invokeRunPipeline>[0]['scraper'],
        members,
        log,
        batchSize:      50,
        resumeFailures: false,
        pipeline:       [],
        targetConfig:   {},
      });

      // Goblin should NOT have been fetched — its slug was already on disk
      assert.equal(stub.fetched.includes('Goblin'), false, 'Goblin should be skipped (file already exists)');

      // Orc SHOULD have been fetched (pipeline tasks handle writing — not tested here)
      assert.equal(stub.fetched.includes('Orc'), true, 'Orc should be fetched (no existing file)');

      // goblin.json should be unchanged (same mtime — not re-written)
      const afterStat = await stat(join(targetDir, 'goblin.json'));
      assert.equal(
        afterStat.mtimeMs,
        beforeStat.mtimeMs,
        'goblin.json mtime must not change — file was skipped',
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
