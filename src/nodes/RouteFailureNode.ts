import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import type { ScrapeState }    from '../state/ScrapeState.js';
import type { RipperServices } from '../services/RipperServices.js';
import {
  LAST_FAILURE_KEY,
  defaultFailurePolicy,
  type FailureContextType,
} from '../resilience/FailurePolicy.js';

type RouteFailureOutput = 'retry' | 'resolve' | 'capture' | 'expected';

/**
 * Policy-driven failure router. Reads the failure context stashed by the
 * preceding node under `LAST_FAILURE_KEY`, increments the attempt counter,
 * classifies the failure via `services.failurePolicy` (or the default policy),
 * and emits the chosen route as its output port.
 *
 * Output ports:
 * - `retry`    — transient failure within budget; wire back to `html:fetch`.
 * - `resolve`  — permanent but potentially resolvable (Wave 3 opt-in).
 * - `capture`  — permanent failure; url added to `state.failed`.
 * - `expected` — known gap; counted as expected, not errored.
 *
 * @category Nodes
 * @since 3.2.0
 */
class RouteFailureNodeImpl extends ScalarNode<ScrapeState, RouteFailureOutput, RipperServices> {
  public readonly name = 'route:failure';
  public readonly outputs = ['retry', 'resolve', 'capture', 'expected'] as const;

  public override get outputSchema(): Record<RouteFailureOutput, SchemaObjectType> {
    return {
      // `retry` — transient failure within budget; attempt recorded, no state delta beyond that.
      retry:    { type: 'object' },
      // `resolve` — permanent but potentially resolvable; strategies stashed under 'resolveStrategies'.
      resolve:  { type: 'object' },
      // `capture` — permanent failure; url appended to `state.failed`.
      capture:  { type: 'object' },
      // `expected` — known gap; counted as expected outcome, not an error.
      expected: { type: 'object' },
    };
  }

  protected override async executeOne(
    state:   ScrapeState,
    context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<RouteFailureOutput>> {
    const stashed = state.getMetadata<FailureContextType>(LAST_FAILURE_KEY);
    if (stashed === undefined) {
      state.failed.push(state.page.url);
      return NodeOutputBuilder.of('capture');
    }

    const attempt = state.recordAttempt('html:fetch');
    const failureContext: FailureContextType = { ...stashed, attempt };

    const policy = context.services.failurePolicy ?? defaultFailurePolicy;
    const decision = policy.classify(failureContext);

    if (decision.route !== 'retry') {
      state.clearAttempts('html:fetch');
    }

    if (decision.route === 'capture') {
      state.failed.push(stashed.url);
    } else if (decision.route === 'resolve') {
      state.setMetadata('resolveStrategies', decision.strategies);
    }

    return NodeOutputBuilder.of(decision.route);
  }
}

export const RouteFailureNode = new RouteFailureNodeImpl();
