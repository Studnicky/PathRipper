import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import { CrawlStreamSource }  from '../../crawlers/CrawlStreamSource.js';
import type { ScrapeState }   from '../../state/ScrapeState.js';
import type { RipperServices } from '../../services/RipperServices.js';

/**
 * Seeds `state.urlStream` with a lazy AsyncIterable<string> crawl frontier.
 *
 * The stream is consumed by a downstream ScatterNode configured with
 * `source: "urlStream"` and a `reservoir` block. Discovery overlaps page
 * processing; the full URL set is never materialised into an array.
 *
 * Output ports:
 * - `ready` — `state.urlStream` is set; scatter can proceed.
 * - `empty` — `services.crawler` is absent or `startUrls` is empty.
 *
 * @category Nodes
 * @since 4.2.0
 */
class StreamFrontierNodeImpl extends ScalarNode<ScrapeState, 'ready' | 'empty', RipperServices> {
  public readonly name = 'crawl:stream';
  public readonly outputs = ['ready', 'empty'] as const;

  public override get outputSchema(): Record<'ready' | 'empty', SchemaObjectType> {
    return {
      ready: { type: 'object' },
      empty: { type: 'object' },
    };
  }

  protected override async executeOne(
    state:   ScrapeState,
    context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<'ready' | 'empty'>> {
    const { services } = context;

    if (services.crawler === undefined || services.crawler.startUrls.length === 0) {
      services.log.warn('crawl:stream', 'crawl:stream called with no crawler config or empty startUrls');
      return NodeOutputBuilder.of('empty');
    }

    state.urlStream = CrawlStreamSource.stream(services);
    services.log.debug('crawl:stream', 'urlStream seeded', {
      startUrls: services.crawler.startUrls.length,
    });
    return NodeOutputBuilder.of('ready');
  }
}

/**
 * Built-in node — seeds `state.urlStream` with a lazy BFS crawl frontier.
 *
 * @remarks
 * Registered as `crawl:stream`. Use with a downstream `ScatterNode` configured
 * with `source: "urlStream"` and a `reservoir` block for bounded-memory streaming.
 *
 * @example
 * ```json
 * { "@type": "SingleNode", "name": "crawl:stream", "node": "crawl:stream" }
 * ```
 *
 * @category Nodes
 * @since 4.2.0
 * @group Crawl
 */
export const StreamFrontierNode = new StreamFrontierNodeImpl();
