// Test helpers for aonprd node unit tests.
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ScrapeState } from '../../../../../src/state/ScrapeState.js';
import { TAXONOMY }    from '../../../../../plugins/aonprd/taxonomy/aonprd.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Reuse the same HTML fixtures as the e2e plugin tests.
const FIXTURE_DIR = resolve(__dirname, '../../../../e2e/plugins/fixtures/aonprd');

export async function loadFixture(name: string): Promise<string> {
  return readFile(resolve(FIXTURE_DIR, name), 'utf-8');
}

/**
 * Build a minimal ScrapeState pre-populated with a page's HTML and URL.
 *
 * Wave 6 M1: when the URL routes to a known concept, the concept's
 * discriminator is stamped onto `state.output` — mirroring the
 * `aonprd:taxonomy-route` node's behaviour in production. Tests that exercise
 * individual capability nodes without dispatching through the full DAG
 * therefore observe the same `_type` field downstream caps see in production.
 */
export function makeState(html: string, url: string): ScrapeState {
  const state = new ScrapeState();
  state.page = { targetId: 'aonprd', title: '', url, html };
  const conceptId = TAXONOMY.routeUrl(url);
  if (conceptId !== null) {
    const discriminator = TAXONOMY.discriminatorFor(conceptId);
    if (Object.keys(discriminator).length > 0) {
      state.output = { ...discriminator };
    }
  }
  return state;
}

/** Minimal NodeContextInterface stub (nodes don't use services in unit tests). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const stubContext: any = { services: {} };
