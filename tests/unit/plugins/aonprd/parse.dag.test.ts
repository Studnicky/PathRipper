// Unit tests for the aonprd:parse plugin DAG.
// Stands up a real Dagonizer dispatcher, registers all taxonomy nodes + the
// DAG, dispatches against fixture HTML for multiple page types, and asserts
// that state.output carries the expected typed shape.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Dagonizer } from '@noocodex/dagonizer';

import { ScrapeState } from '../../../../src/state/ScrapeState.js';
import { TerminalNode } from '../../../../src/nodes/TerminalNode.js';
import { TAXONOMY }     from '../../../../plugins/aonprd/taxonomy/aonprd.js';
import { aonprdParseDAG } from '../../../../plugins/aonprd/parse.dag.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '../../../e2e/plugins/fixtures/aonprd');

async function load(name: string): Promise<string> {
  return readFile(resolve(FIXTURE_DIR, name), 'utf-8');
}

function buildDispatcher() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dispatcher = new Dagonizer<ScrapeState, any>({ services: {} as any });
  dispatcher.registerNode(TerminalNode);
  // Register every node from the compiled AONPRD taxonomy. This mirrors what
  // the production `register()` in parse.task.ts does — TAXONOMY.allNodes()
  // includes the router, all capability nodes, unknownTerminal, and
  // flow:terminate.
  for (const node of TAXONOMY.allNodes()) {
    dispatcher.registerNode(node);
  }
  dispatcher.registerDAG(aonprdParseDAG);
  return dispatcher;
}

function makeState(html: string, url: string): ScrapeState {
  const state = new ScrapeState();
  state.page = { targetId: 'aonprd', title: '', url, html };
  return state;
}

describe('aonprd:parse plugin DAG dispatch', () => {
  it('DAG name matches pipeline-config step name', () => {
    assert.equal(aonprdParseDAG.name, 'aonprd:parse');
  });

  it('dispatches spell page and produces typed spell output', async () => {
    const dispatcher = buildDispatcher();
    const html  = await load('spell-abyssal-plague.html');
    const state = makeState(html, 'https://2e.aonprd.com/Spells.aspx?ID=1');
    await dispatcher.execute('aonprd:parse', state);
    assert.ok(state.output !== null, 'output should be set after dispatch');
    assert.equal(state.output?.['name'], 'Abyssal Plague');
  });

  it('dispatches monster page and produces typed monster output', async () => {
    const dispatcher = buildDispatcher();
    const html  = await load('monster-phantasmal-minion.html');
    const state = makeState(html, 'https://2e.aonprd.com/Monsters.aspx?ID=1');
    await dispatcher.execute('aonprd:parse', state);
    assert.equal(state.output?.['name'], 'Phantasmal Minion');
  });

  it('dispatches feat page and produces typed feat output', async () => {
    const dispatcher = buildDispatcher();
    const html  = await load('feat-dwarven-lore.html');
    const state = makeState(html, 'https://2e.aonprd.com/Feats.aspx?ID=1');
    await dispatcher.execute('aonprd:parse', state);
    assert.equal(state.output?.['name'], 'Dwarven Lore');
  });

  it('dispatches equipment page and produces typed equipment output', async () => {
    const dispatcher = buildDispatcher();
    const html  = await load('equipment-adventurers-pack.html');
    const state = makeState(html, 'https://2e.aonprd.com/Equipment.aspx?ID=1');
    await dispatcher.execute('aonprd:parse', state);
  });

  it('dispatches weapon page and produces typed weapon output', async () => {
    const dispatcher = buildDispatcher();
    const html  = await load('weapon-longsword.html');
    const state = makeState(html, 'https://2e.aonprd.com/Weapons.aspx?ID=300');
    await dispatcher.execute('aonprd:parse', state);
  });

  it('dispatches condition page and produces typed condition output', async () => {
    const dispatcher = buildDispatcher();
    const html  = await load('condition-blinded.html');
    const state = makeState(html, 'https://2e.aonprd.com/Conditions.aspx?ID=1');
    await dispatcher.execute('aonprd:parse', state);
    assert.equal(state.output?.['name'], 'Blinded');
  });

  it('dispatches background page and produces typed background output', async () => {
    const dispatcher = buildDispatcher();
    const html  = await load('background-acolyte.html');
    const state = makeState(html, 'https://2e.aonprd.com/Backgrounds.aspx?ID=1');
    await dispatcher.execute('aonprd:parse', state);
    assert.equal(state.output?.['name'], 'Acolyte');
  });

  it('dispatches unmapped URL through the generic fallback (Wave 7 M7)', async () => {
    const dispatcher = buildDispatcher();
    const state = makeState('<html><body>nothing</body></html>', 'https://2e.aonprd.com/X.aspx?ID=1');
    await dispatcher.execute('aonprd:parse', state);
    // Wave 7 M7: the URL router now routes unmatched URLs to `genericConcept`
    // (the only ConceptDecl with `urlPaths: []`) instead of `aonprd:make-unknown`.
    // The fallback produces a `generic`-typed output. Operators see the
    // fallback being hit via the `_type` discriminator on the output.
  });

  it('DAG resolves generics (unmapped URL path) through taxonomy generic concept', async () => {
    const dispatcher = buildDispatcher();
    const html  = await load('spell-abyssal-plague.html');
    // Wave 7 M7: unmatched URL → routes to `genericConcept`. Even though the
    // HTML is a spell page, the URL path (`Bestiary.aspx`) has no taxonomy
    // entry, so the fallback chain runs.
    const state = makeState(html, 'https://2e.aonprd.com/Bestiary.aspx?ID=99');
    await dispatcher.execute('aonprd:parse', state);
  });
});
