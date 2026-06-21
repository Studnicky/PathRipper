// Test helpers for aonprd node unit tests.
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ScrapeState } from '../../../../../src/state/ScrapeState.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Reuse the same HTML fixtures as the e2e plugin tests.
const FIXTURE_DIR = resolve(__dirname, '../../../../e2e/plugins/fixtures/aonprd');

export async function loadFixture(name: string): Promise<string> {
  return readFile(resolve(FIXTURE_DIR, name), 'utf-8');
}

/** Build a minimal ScrapeState pre-populated with a page's HTML and URL. */
export function makeState(html: string, url: string): ScrapeState {
  const state = new ScrapeState();
  state.page = { targetId: 'aonprd', title: '', url, html };
  return state;
}

/** Minimal NodeContextType stub (nodes don't use services in unit tests). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const stubContext: any = { services: {} };
