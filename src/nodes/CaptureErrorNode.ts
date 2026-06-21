import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import type { ScrapeState }    from '../state/ScrapeState.js';
import type { RipperServices } from '../services/RipperServices.js';

/**
 * Projects the errors collected on `state.errors` into `state.output` as an
 * inspectable error document, so a failing page persists a `{ _type: 'error' }`
 * record (via the downstream `json:write`) instead of vanishing.
 *
 * Errors are data. A node that throws or routes its `error` port has its
 * `NodeError` recorded on `state.errors`, but nothing writes that out — across
 * the worker boundary a thrown exception is reduced to an opaque `error`
 * partition with no detail. This node is the DAG route that makes per-page
 * failures first-class, written, and inspectable: wire a node's `error` port to
 * `error:capture`, then route `captured` to a write node.
 *
 * Output ports:
 * - `captured` — `state.output` set to the error document.
 *
 * @category Nodes
 * @since 4.3.0
 */
class CaptureErrorNodeImpl extends ScalarNode<ScrapeState, 'captured', RipperServices> {
  public readonly name = 'error:capture';
  public readonly outputs = ['captured'] as const;

  public override get outputSchema(): Record<'captured', SchemaObjectType> {
    return {
      // `captured` — `state.output` holds the error document: the failing url
      // and every `NodeError` collected on `state.errors`, projected to data.
      captured: {
        type: 'object',
        properties: {
          output: {
            type: 'object',
            properties: {
              _type: { type: 'string' },
              url:   { type: 'string' },
              errors: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    code:      { type: 'string' },
                    message:   { type: 'string' },
                    operation: { type: 'string' },
                    context:   { type: 'object' },
                  },
                  required: ['code', 'message', 'operation'],
                },
              },
            },
            required: ['_type', 'url', 'errors'],
          },
        },
        required: ['output'],
      },
    };
  }

  protected override async executeOne(
    state:    ScrapeState,
    _context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<'captured'>> {
    state.output = {
      _type: 'error',
      url:   state.page.url,
      errors: state.errors.map((nodeError) => ({
        code:      nodeError.code,
        message:   nodeError.message,
        operation: nodeError.operation,
        context:   nodeError.context,
      })),
    };
    return NodeOutputBuilder.of('captured');
  }
}

export const CaptureErrorNode = new CaptureErrorNodeImpl();
