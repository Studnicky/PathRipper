/**
 * Run module index — re-exports `runHtml` and `runWiki` via a named object
 * so tests can intercept calls with `mock.method(run, 'runHtml', ...)` without
 * requiring `--experimental-test-module-mocks`.
 *
 * @module run
 * @since 4.0.0
 */

export { runHtml }   from './runHtml.js';
export { runWiki }   from './runWiki.js';
export type { ScrapeHtmlOptionsInterface } from './runHtml.js';
export type { ScrapeWikiOptionsInterface } from './runWiki.js';
