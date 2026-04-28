/** Normalized page data carried through the pipeline for both HTML and wiki sources. */
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

/** Shared mutable state passed through every task in a pipeline run. */
export interface PipelineStateInterface extends Record<string, unknown> {
  /** Scrape target identifier from the config. */
  readonly targetId: string;
  /** Normalized page data for this pipeline execution. */
  readonly page:     PipelinePageInterface;
  /** Parsed output written by tasks; `null` until a task populates it. */
  output: Record<string, unknown> | null;
}
