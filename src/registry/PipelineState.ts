import type { WikiPageInterface } from '../types/MediaWikiScraper.js';
import type { ScrapedPageInterface } from '../types/HtmlScraper.js';
import type { PipelinePageInterface, PipelineStateInterface } from '../types/PipelineState.js';

export type { PipelinePageInterface, PipelineStateInterface };

/**
 * Factory for creating initial PipelineStateInterface objects from scraped pages.
 *
 * @remarks
 * All methods are static; the class cannot be instantiated.
 * Produced state objects have `output` initialised to `null` and are ready to pass into a {@link Pipeline}.
 *
 * @example
 * ```ts
 * const state = PipelineState.fromWikiPage('monsters', wikiPage);
 * await pipeline.execute(state);
 * ```
 *
 * @category Registry
 * @since 2.0.0
 * @see {@link PipelineStateInterface}
 * @group Core
 */
export class PipelineState {
  private constructor() { /* static-only */ }

  /**
   * Creates a pipeline state from a MediaWiki wiki page.
   *
   * @param targetId - Config target key identifying the wiki target.
   * @param page - Wiki page with title and wikitext content.
   * @returns Initial pipeline state with `output` set to `null`.
   */
  public static fromWikiPage(targetId: string, page: WikiPageInterface): PipelineStateInterface {
    return {
      targetId,
      page: { targetId, title: page.title, url: '', wikitext: page.wikitext },
      output: null,
    };
  }

  /**
   * Creates a pipeline state from a scraped HTML page.
   *
   * @param targetId - Config target key identifying the HTML target.
   * @param page - Scraped HTML page with resolved URL and content.
   * @returns Initial pipeline state with `output` set to `null`.
   */
  public static fromHtmlPage(targetId: string, page: ScrapedPageInterface): PipelineStateInterface {
    return {
      targetId,
      page: { targetId, title: page.url, url: page.url, html: page.html },
      output: null,
    };
  }
}
