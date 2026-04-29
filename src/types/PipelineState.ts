/**
 * Normalized page data carried through the pipeline for both HTML and wiki sources.
 *
 * @remarks
 * Either `html` or `wikitext` (or both) will be present depending on the
 * scrape source.  Tasks should check for the field they need before accessing
 * it.
 *
 * @example
 * ```ts
 * const page: PipelinePageInterface = {
 *   targetId: 'pathfinder-monsters',
 *   title: 'Goblin',
 *   url: 'https://example.com/wiki/Goblin',
 *   wikitext: '{{Infobox|name=Goblin}}',
 * };
 * ```
 *
 * @category Pipeline
 * @since 2.0.0
 * @see {@link PipelineStateInterface}
 * @group Types
 */
export interface PipelinePageInterface {
  /** Scrape target identifier from the config. */
  readonly targetId:  string;
  /** Page title or URL used as a display/slug source. */
  readonly title:     string;
  /** Resolved URL of the page, if available. */
  readonly url:       string;
  /** Raw wikitext, present for MediaWiki-sourced pages. */
  readonly wikitext?: string | undefined;
  /** Raw HTML, present for HTML-sourced pages. */
  readonly html?:     string | undefined;
}

/**
 * Shared mutable state passed through every task in a single pipeline run.
 *
 * @remarks
 * `output` starts as `null` and is expected to be populated by one of the
 * pipeline tasks.  Tasks may also attach arbitrary extra keys via the
 * `Record<string, unknown>` index signature for inter-task communication.
 *
 * @example
 * ```ts
 * const state: PipelineStateInterface = {
 *   targetId: 'pathfinder-monsters',
 *   page: { targetId: 'pathfinder-monsters', title: 'Goblin', url: '...' },
 *   output: null,
 * };
 * ```
 *
 * @category Pipeline
 * @since 2.0.0
 * @see {@link PipelinePageInterface}
 * @group Types
 */
export interface PipelineStateInterface extends Record<string, unknown> {
  /** Scrape target identifier from the config. */
  readonly targetId: string;
  /** Normalized page data for this pipeline execution. */
  readonly page:     PipelinePageInterface;
  /** Parsed output written by tasks; `null` until a task populates it. */
  output: Record<string, unknown> | null;
}
