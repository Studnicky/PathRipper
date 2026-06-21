// Capability: extract:meta-tags
// Reads the parsed `aonprdCheerio` document and projects `<meta>` tag
// content into a structured `aonprdMetaTags` metadata bag. Consumed by
// concept finalize nodes that previously called `extractMetaDescription` +
// `extractMetaKeywords` inline.
//
// Lifted into Layer 1 so the capability runs once per page and every concept
// reads from `aonprdMetaTags` rather than re-implementing extraction inline.
//
// Open-world convention: soft-fail to `'success'` with no writes when
// `aonprdCheerio` is absent (e.g. rule pages whose load short-circuits).
import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';
import type { CheerioAPI } from 'cheerio';

import type { ScrapeState }    from '../../../src/state/ScrapeState.js';
import { extractMetaDescription, extractMetaKeywords } from '../common.js';

/** Structured shape of the `aonprdMetaTags` metadata bag. */
export interface AonprdMetaTags {
  readonly description: string | null;
  readonly keywords:    string | null;
}

export type MetaTagsOutput = 'success';

class MetaTagsNode extends ScalarNode<ScrapeState, MetaTagsOutput> {
  public readonly name = 'extract:meta-tags';
  public readonly outputs = ['success'] as const;

  public override get outputSchema(): Record<MetaTagsOutput, SchemaObjectType> {
    return {
      // `success` — writes `aonprdMetaTags` metadata key: { description: string|null, keywords: string|null }.
      // No state.output delta; soft-fails with no writes when `aonprdCheerio` is absent.
      success: { type: 'object' },
    };
  }

  protected override async executeOne(
    state: ScrapeState,
    _ctx:  NodeContextType,
  ): Promise<NodeOutputType<MetaTagsOutput>> {
    const root = state.getMetadata<CheerioAPI>('aonprdCheerio');
    if (root === undefined) return NodeOutputBuilder.of('success');
    const meta: AonprdMetaTags = {
      description: extractMetaDescription(root),
      keywords:    extractMetaKeywords(root),
    };
    state.setMetadata('aonprdMetaTags', meta);
    return NodeOutputBuilder.of('success');
  }
}

export const metaTagsNode = new MetaTagsNode();
