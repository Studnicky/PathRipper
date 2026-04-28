import type { WikiPageInterface } from '../scrapers/MediaWikiScraper.js';
import type { ScrapedPageInterface } from '../scrapers/HtmlScraper.js';

export interface PipelinePageInterface {
  readonly targetId:  string;
  readonly title:     string;
  readonly url:       string;
  readonly wikitext?: string | undefined;
  readonly html?:     string | undefined;
}

export interface PipelineStateInterface extends Record<string, unknown> {
  readonly targetId: string;
  readonly page:     PipelinePageInterface;
  output: Record<string, unknown> | null;
}

export class PipelineState {
  private constructor() { /* static-only */ }

  public static fromWikiPage(targetId: string, page: WikiPageInterface): PipelineStateInterface {
    return {
      targetId,
      page: { targetId, title: page.title, url: '', wikitext: page.wikitext },
      output: null,
    };
  }

  public static fromHtmlPage(targetId: string, page: ScrapedPageInterface): PipelineStateInterface {
    return {
      targetId,
      page: { targetId, title: page.url, url: page.url, html: page.html },
      output: null,
    };
  }
}
