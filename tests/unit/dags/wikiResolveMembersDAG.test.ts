// Unit tests for the wikiResolveMembersFlow.
//
// Verifies that each of the four branches populates state.members correctly
// by replacing the real scraper with a stub and exercising the full flow.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';

import { Dagonizer } from '@noocodex/dagonizer';

import { MemberResolutionState }                        from '../../../src/state/MemberResolutionState.js';
import { wikiResolveMembersFlow, WIKI_RESOLVE_MEMBERS_FLOW } from '../../../src/flows/wikiScrapeFlow.js';
import {
  ChooseModeNode,
  ResumeFailuresNode,
  FetchSingleCategoryNode,
  FetchMultipleCategoriesNode,
  FetchAllPagesNode,
} from '../../../src/nodes/wiki/index.js';
import type { CategoryMemberInterface } from '../../../src/types/MediaWikiScraper.js';
import type { RipperServices }             from '../../../src/services/RipperServices.js';
import { Logger }                       from '../../../src/modules/logger/logger.js';

// ── Stub scraper ───────────────────────────────────────────────────────────────

class StubWikiScraper {
  private readonly categories: Map<string, CategoryMemberInterface[]>;
  private readonly allPagesData: CategoryMemberInterface[];

  public constructor(
    categories: Map<string, CategoryMemberInterface[]>,
    allPages:   CategoryMemberInterface[],
  ) {
    this.categories    = categories;
    this.allPagesData  = allPages;
  }

  public async fetchCategory(name: string): Promise<CategoryMemberInterface[]> {
    return this.categories.get(name) ?? [];
  }

  public async fetchAllPages(_batchSize?: number): Promise<CategoryMemberInterface[]> {
    return this.allPagesData;
  }
}

// ── Helper ─────────────────────────────────────────────────────────────────────

const buildDispatcher = (outDir: string, scraper?: StubWikiScraper): Dagonizer<MemberResolutionState, RipperServices> => {
  const services = {
    log:         Logger.forComponent('wikiResolveMembersFlow.test'),
    cache:       null,
    wikiScraper: scraper as unknown as RipperServices['wikiScraper'],
    target:      { id: 'test', cfg: {} },
    outDir,
  } as unknown as RipperServices;

  const dispatcher = new Dagonizer<MemberResolutionState, RipperServices>({ services });
  dispatcher.registerNode(ChooseModeNode);
  dispatcher.registerNode(ResumeFailuresNode);
  dispatcher.registerNode(FetchSingleCategoryNode);
  dispatcher.registerNode(FetchMultipleCategoriesNode);
  dispatcher.registerNode(FetchAllPagesNode);
  dispatcher.registerDAG(wikiResolveMembersFlow);
  return dispatcher;
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('wikiResolveMembersFlow', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ripperoni-members-flow-'));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('resume-failures branch reads titles from failures.json', async () => {
    const targetId  = 'wikitest';
    const targetDir = join(tmpDir, 'rf', targetId);
    await mkdir(targetDir, { recursive: true });

    const manifest = { timestamp: new Date().toISOString(), count: 2, titles: ['Alpha', 'Beta'] };
    await writeFile(join(targetDir, 'failures.json'), JSON.stringify(manifest));

    const dispatcher = buildDispatcher(join(tmpDir, 'rf'));
    const state      = new MemberResolutionState();
    state.target         = targetId;
    state.resumeFailures = true;

    await dispatcher.execute(WIKI_RESOLVE_MEMBERS_FLOW, state);

    assert.equal(state.members.length, 2);
    assert.deepEqual(
      state.members.map((m) => m.title),
      ['Alpha', 'Beta'],
    );
    assert.ok(state.members.every((m) => m.pageid === 0));
  });

  it('single-category branch fetches members for the given category', async () => {
    const scraper = new StubWikiScraper(
      new Map([['Ships', [{ title: 'Galleon', pageid: 1 }, { title: 'Frigate', pageid: 2 }]]]),
      [],
    );
    const dispatcher = buildDispatcher(tmpDir, scraper);

    const state    = new MemberResolutionState();
    state.category = 'Ships';

    await dispatcher.execute(WIKI_RESOLVE_MEMBERS_FLOW, state);

    assert.equal(state.members.length, 2);
    assert.deepEqual(state.members.map((m) => m.title), ['Galleon', 'Frigate']);
  });

  it('by-categories branch fetches multiple categories and deduplicates members', async () => {
    const scraper = new StubWikiScraper(
      new Map([
        ['Ships',    [{ title: 'Galleon', pageid: 1 }, { title: 'Frigate', pageid: 2 }]],
        ['Monsters', [{ title: 'Goblin',  pageid: 3 }, { title: 'Galleon', pageid: 1 }]], // Galleon duplicated
      ]),
      [],
    );
    const dispatcher = buildDispatcher(tmpDir, scraper);

    const state  = new MemberResolutionState();
    state.config = { categories: ['Ships', 'Monsters'] };

    await dispatcher.execute(WIKI_RESOLVE_MEMBERS_FLOW, state);

    assert.equal(state.members.length, 3, 'deduplicated set should have 3 unique titles');
    const titles = state.members.map((m) => m.title);
    assert.ok(titles.includes('Galleon'));
    assert.ok(titles.includes('Frigate'));
    assert.ok(titles.includes('Goblin'));
  });

  it('all-pages branch enumerates all pages in main namespace', async () => {
    const scraper = new StubWikiScraper(
      new Map(),
      [{ title: 'PageA', pageid: 10 }, { title: 'PageB', pageid: 11 }],
    );
    const dispatcher = buildDispatcher(tmpDir, scraper);

    const state = new MemberResolutionState();
    // no resumeFailures, no category, no config.categories → all-pages

    await dispatcher.execute(WIKI_RESOLVE_MEMBERS_FLOW, state);

    assert.equal(state.members.length, 2);
    assert.deepEqual(state.members.map((m) => m.title), ['PageA', 'PageB']);
  });

  it('resume-failures branch returns error output when failures.json is missing', async () => {
    const dispatcher = buildDispatcher(join(tmpDir, 'missing'));
    const state      = new MemberResolutionState();
    state.target         = 'nonexistent';
    state.resumeFailures = true;

    // The node sets error output and collects an error — state.members stays empty.
    await dispatcher.execute(WIKI_RESOLVE_MEMBERS_FLOW, state);

    assert.equal(state.members.length, 0, 'members should remain empty when failures.json is missing');
    assert.ok(state.errors.length > 0, 'an error should have been collected');
  });

  it('wikiResolveMembersFlow is independently dispatchable', () => {
    // Verifies the flow has expected structure (structural check).
    assert.equal(wikiResolveMembersFlow.name, WIKI_RESOLVE_MEMBERS_FLOW);
    assert.ok(wikiResolveMembersFlow.nodes.length >= 5, 'flow must have at least 5 nodes (choose-mode + 4 branch nodes)');
  });
});
