// Registration-time DAG validation integration.
//
// Verifies that:
//   1. Registering the live AONPRD taxonomy completes without throwing.
//   2. A DAG that references a node not present in the registry throws
//      `DAGError` at registerDAG time (unresolved placement → hard error).
//   3. A DAG that references two unregistered nodes throws at registerDAG
//      time, confirming the validator covers all placements.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { NodeInterface, NodeContextType, Batch, SchemaObjectType } from '@studnicky/dagonizer';
import { DAGBuilder, DAGError, RoutedBatchBuilder, Timeout } from '@studnicky/dagonizer';

import { RipperDagonizer } from '../../../../src/dispatcher/RipperDagonizer.js';
import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';

import { TAXONOMY } from '../../../../plugins/aonprd/taxonomy/aonprd.js';
import { aonprdParseDAG } from '../../../../plugins/aonprd/parse.dag.js';

function buildServices(): RipperServices {
  return {} as RipperServices;
}

// ─── Test 1: live taxonomy registration — zero errors ────────────────────────

describe('ContractRegistryValidator integration', () => {
  it('live AONPRD taxonomy registers without throwing', () => {
    const dispatcher = new RipperDagonizer<ScrapeState>({
      services: buildServices(),
    });
    for (const node of TAXONOMY.allNodes()) {
      dispatcher.registerNode(node as unknown as NodeInterface<ScrapeState, string, RipperServices>);
    }
    assert.doesNotThrow(() => { dispatcher.registerDAG(aonprdParseDAG); });
  });

  // ─── Test 2: unresolved placement — throws DAGError at registerDAG ──────────

  it('DAG referencing unregistered node throws DAGError at registerDAG', () => {
    // Build a minimal DAG that references 'broken:nodeB' which is NOT registered.
    // registerDAG must throw DAGError when it finds an unresolved placement.
    const nodeA: NodeInterface<ScrapeState, 'success', RipperServices> = {
      name:         'broken:nodeA',
      outputs:      ['success'] as const,
      timeout:      Timeout.none(),
      outputSchema: { success: { type: 'object' } } as Record<'success', SchemaObjectType>,
      async execute(
        batch: Batch<ScrapeState>,
        _ctx:  NodeContextType<RipperServices>,
      ): Promise<ReturnType<typeof RoutedBatchBuilder.of<'success', ScrapeState>>> {
        return RoutedBatchBuilder.of('success', batch);
      },
    };

    const brokenDag = new DAGBuilder('broken-dag-1', '1.0')
      .node('broken:nodeA', nodeA, { success: 'broken:nodeB' })
      .node('broken:nodeB', {
        name:         'broken:nodeB',
        outputs:      ['done'] as const,
        timeout:      Timeout.none(),
        outputSchema: { done: { type: 'object' } } as Record<'done', SchemaObjectType>,
        async execute(
          batch: Batch<ScrapeState>,
          _ctx:  NodeContextType<RipperServices>,
        ): Promise<ReturnType<typeof RoutedBatchBuilder.of<'done', ScrapeState>>> {
          return RoutedBatchBuilder.of('done', batch);
        },
      }, { done: 'broken-done' })
      .terminal('broken-done', { outcome: 'completed' })
      .build();

    const dispatcher = new RipperDagonizer<ScrapeState>({
      services: buildServices(),
    });
    // Register only nodeA — NOT nodeB. The DAG references both.
    dispatcher.registerNode(nodeA);

    assert.throws(
      () => dispatcher.registerDAG(brokenDag),
      (err: unknown) => {
        assert.ok(err instanceof DAGError, `expected DAGError, got ${String(err)}`);
        return true;
      },
      'registerDAG must throw DAGError when a placement references an unregistered node',
    );
  });

  // ─── Test 3: completely unregistered DAG nodes — throws DAGError ─────────────

  it('DAG with no registered nodes at all throws DAGError at registerDAG', () => {
    const entryNode: NodeInterface<ScrapeState, 'success', RipperServices> = {
      name:         'unregistered:entry',
      outputs:      ['success'] as const,
      timeout:      Timeout.none(),
      outputSchema: { success: { type: 'object' } } as Record<'success', SchemaObjectType>,
      async execute(
        batch: Batch<ScrapeState>,
        _ctx:  NodeContextType<RipperServices>,
      ): Promise<ReturnType<typeof RoutedBatchBuilder.of<'success', ScrapeState>>> {
        return RoutedBatchBuilder.of('success', batch);
      },
    };

    const tailNode: NodeInterface<ScrapeState, 'success', RipperServices> = {
      name:         'unregistered:tail',
      outputs:      ['success'] as const,
      timeout:      Timeout.none(),
      outputSchema: { success: { type: 'object' } } as Record<'success', SchemaObjectType>,
      async execute(
        batch: Batch<ScrapeState>,
        _ctx:  NodeContextType<RipperServices>,
      ): Promise<ReturnType<typeof RoutedBatchBuilder.of<'success', ScrapeState>>> {
        return RoutedBatchBuilder.of('success', batch);
      },
    };

    const dag = new DAGBuilder('unregistered-dag', '1.0')
      .node('unregistered:entry', entryNode, { success: 'unregistered:tail' })
      .node('unregistered:tail', tailNode, { success: 'unregistered-done' })
      .terminal('unregistered-done', { outcome: 'completed' })
      .build();

    const dispatcher = new RipperDagonizer<ScrapeState>({
      services: buildServices(),
    });
    // Register neither node — the DAG references both.

    assert.throws(
      () => dispatcher.registerDAG(dag),
      (err: unknown) => {
        assert.ok(err instanceof DAGError, `expected DAGError, got ${String(err)}`);
        return true;
      },
      'registerDAG must throw DAGError when no referenced nodes are registered',
    );
  });
});
