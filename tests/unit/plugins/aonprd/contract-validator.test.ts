// Registration-time contract validation integration.
//
// Verifies that:
//   1. Registering the live AONPRD taxonomy completes without throwing.
//   2. A DAG whose node declares a hardRequired path that no predecessor produces
//      throws `DAGError` at derivation time (dangling read → hard error in 0.23).
//   3. A DAG whose entrypoint node produces a field that no downstream node
//      reads (dead write) throws `DAGError` at build time (dead-write → hard
//      error in 0.23; there is no non-fatal warning hook on RipperDagonizer).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { NodeInterface, NodeContextType, Batch, DAGType } from '@studnicky/dagonizer';
import { DAGBuilder, DAGError, RoutedBatchBuilder, Timeout } from '@studnicky/dagonizer';
import type { OperationContractFragmentType } from '@studnicky/dagonizer';

import { RipperDagonizer } from '../../../../src/dispatcher/RipperDagonizer.js';
import type { ScrapeState } from '../../../../src/state/ScrapeState.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';

import { TAXONOMY } from '../../../../plugins/aonprd/taxonomy/aonprd.js';
import { aonprdParseDAG } from '../../../../plugins/aonprd/parse.dag.js';

function buildServices(): RipperServices {
  return {} as RipperServices;
}

// ─── Test 1: live taxonomy registration — zero warnings ─────────────────────

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

  // ─── Test 2: broken taxonomy — DAG derivation throws ──────────────────────

  it('broken taxonomy (hardRequired with no producer) throws DAGError at DAG derivation', () => {
    // Node A produces nothing.
    const nodeA: NodeInterface<ScrapeState, 'success', RipperServices> = {
      name:     'broken:nodeA',
      outputs:  ['success'] as const,
      timeout:  Timeout.none(),
      contract: {
        hardRequired: [] as const,
        produces:     [] as const,
      } satisfies OperationContractFragmentType,
      async execute(
        batch: Batch<ScrapeState>,
        _ctx:  NodeContextType<RipperServices>,
      ): Promise<ReturnType<typeof RoutedBatchBuilder.of<'success', ScrapeState>>> {
        return RoutedBatchBuilder.of('success', batch);
      },
    };

    // Node B reads `dangling.field` — nothing in the registry produces it.
    const nodeB: NodeInterface<ScrapeState, 'success', RipperServices> = {
      name:     'broken:nodeB',
      outputs:  ['success'] as const,
      timeout:  Timeout.none(),
      contract: {
        hardRequired: ['dangling.field'] as const,
        produces:     [] as const,
      } satisfies OperationContractFragmentType,
      async execute(
        batch: Batch<ScrapeState>,
        _ctx:  NodeContextType<RipperServices>,
      ): Promise<ReturnType<typeof RoutedBatchBuilder.of<'success', ScrapeState>>> {
        return RoutedBatchBuilder.of('success', batch);
      },
    };

    // `DAGDeriver.derive` runs `ContractRegistryValidator.validate` internally
    // and throws at derivation time when a hardRequired path is dangling.
    // The entrypoint's hardRequired is exempt (treated as initial state), so
    // we put the dangling read on nodeB and use nodeA as the entrypoint.
    assert.throws(
      () => DAGBuilder.derive('broken-test', '1.0', 'broken:nodeA', [nodeA, nodeB] as unknown as NodeInterface[], {
        annotations: {
          terminals: {
            'broken:nodeA': [{ outcome: 'success', target: 'broken:nodeB' }],
            'broken:nodeB': [{ outcome: 'success', emit: { name: 'broken-done', outcome: 'completed' } }],
          },
        },
      }),
      (err: unknown) => {
        assert.ok(err instanceof DAGError, `expected DAGError, got ${String(err)}`);
        assert.match(
          (err as DAGError).message,
          /dangling|hardRequires|ContractRegistryValidator/i,
          `error message: ${(err as DAGError).message}`,
        );
        return true;
      },
    );
  });

  // ─── Test 3: dead-write — throws DAGError at build time ───────────────────

  it('dead-write (produces with no downstream consumer) throws DAGError at DAG build/registration', () => {
    // entrypoint produces 'unused-field', no downstream node reads it → dead write.
    const entryNode: NodeInterface<ScrapeState, 'success', RipperServices> = {
      name:     'dead-write:entry',
      outputs:  ['success'] as const,
      timeout:  Timeout.none(),
      contract: {
        hardRequired: [] as const,
        produces:     ['unused-field'] as const,
      } satisfies OperationContractFragmentType,
      async execute(
        batch: Batch<ScrapeState>,
        _ctx:  NodeContextType<RipperServices>,
      ): Promise<ReturnType<typeof RoutedBatchBuilder.of<'success', ScrapeState>>> {
        return RoutedBatchBuilder.of('success', batch);
      },
    };

    const tailNode: NodeInterface<ScrapeState, 'success', RipperServices> = {
      name:     'dead-write:tail',
      outputs:  ['success'] as const,
      timeout:  Timeout.none(),
      contract: {
        hardRequired: [] as const,
        produces:     [] as const,
      } satisfies OperationContractFragmentType,
      async execute(
        batch: Batch<ScrapeState>,
        _ctx:  NodeContextType<RipperServices>,
      ): Promise<ReturnType<typeof RoutedBatchBuilder.of<'success', ScrapeState>>> {
        return RoutedBatchBuilder.of('success', batch);
      },
    };

    // In 0.23, dead-writes are a hard DAGError at build/registerDAG time.
    // Either DAGBuilder.derive or dispatcher.registerDAG must throw.
    let dag: DAGType | undefined;
    let buildThrew = false;
    try {
      dag = DAGBuilder.derive('dead-write-test', '1.0', 'dead-write:entry', [entryNode, tailNode] as unknown as NodeInterface[], {
        annotations: {
          terminals: {
            'dead-write:entry': [{ outcome: 'success', target: 'dead-write:tail' }],
            'dead-write:tail':  [{ outcome: 'success', emit: { name: 'dw-done', outcome: 'completed' } }],
          },
        },
      });
    } catch (err: unknown) {
      assert.ok(err instanceof DAGError, `expected DAGError at derive, got ${String(err)}`);
      buildThrew = true;
    }

    if (!buildThrew && dag !== undefined) {
      // derive succeeded — enforce the error at registerDAG.
      const dispatcher = new RipperDagonizer<ScrapeState>({
        services: buildServices(),
      });
      dispatcher.registerNode(entryNode);
      dispatcher.registerNode(tailNode);
      assert.throws(
        () => dispatcher.registerDAG(dag!),
        (err: unknown) => {
          assert.ok(err instanceof DAGError, `expected DAGError at registerDAG, got ${String(err)}`);
          return true;
        },
      );
    }
  });
});
