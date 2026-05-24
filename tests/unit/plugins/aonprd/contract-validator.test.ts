// Registration-time `ContractRegistryValidator` integration.
//
// Verifies that:
//   1. `RipperDagonizer.onContractWarning` is wired and surfaces dead-write
//      warnings via the project logger AND (when collectContractWarnings is
//      enabled) retains them for inspection.
//   2. Registering the live AONPRD taxonomy emits zero contract warnings.
//   3. Registering a deliberately-broken DAG (a node declaring a hardRequired
//      path that no predecessor produces) throws `DAGError` at registration
//      time.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import { DAGDeriver } from '@noocodex/dagonizer/derive';
import { DAGError } from '@noocodex/dagonizer';

import { RipperDagonizer } from '../../../../src/dispatcher/RipperDagonizer.js';
import { ScrapeState } from '../../../../src/state/ScrapeState.js';
import { TerminalNode } from '../../../../src/nodes/TerminalNode.js';
import type { RipperServices } from '../../../../src/services/RipperServices.js';

import { TAXONOMY } from '../../../../plugins/aonprd/taxonomy/aonprd.js';
import { aonprdParseDAG } from '../../../../plugins/aonprd/parse.dag.js';

function buildServices(): RipperServices {
  return {} as RipperServices;
}

// ─── Test 1: live taxonomy registration — zero warnings ─────────────────────

describe('ContractRegistryValidator integration', () => {
  it('live AONPRD taxonomy registers without contract warnings', () => {
    const dispatcher = new RipperDagonizer<ScrapeState>({
      services: buildServices(),
      collectContractWarnings: true,
    });
    dispatcher.registerNode(TerminalNode);
    for (const node of TAXONOMY.allNodes()) {
      dispatcher.registerNode(node);
    }
    dispatcher.registerDAG(aonprdParseDAG);

    const warnings = dispatcher.contractWarnings();
    assert.deepEqual(
      warnings,
      [],
      `expected zero contract warnings from live taxonomy, got:\n  ${warnings.join('\n  ')}`,
    );
  });

  // ─── Test 2: broken taxonomy — DAG derivation throws ──────────────────────

  it('broken taxonomy (hardRequired with no producer) throws DAGError at DAG derivation', () => {
    // Node A produces nothing.
    const nodeA: NodeInterface<ScrapeState, 'success', RipperServices> = {
      name:    'broken:nodeA',
      outputs: ['success'] as const,
      contract: {
        hardRequired: [] as const,
        produces:     [] as const,
      } satisfies OperationContractFragment,
      async execute(
        _state: ScrapeState,
        _ctx:   NodeContextInterface<RipperServices>,
      ): Promise<{ output: 'success' }> {
        return { output: 'success' };
      },
    };

    // Node B reads `dangling.field` — nothing in the registry produces it.
    const nodeB: NodeInterface<ScrapeState, 'success', RipperServices> = {
      name:    'broken:nodeB',
      outputs: ['success'] as const,
      contract: {
        hardRequired: ['dangling.field'] as const,
        produces:     [] as const,
      } satisfies OperationContractFragment,
      async execute(
        _state: ScrapeState,
        _ctx:   NodeContextInterface<RipperServices>,
      ): Promise<{ output: 'success' }> {
        return { output: 'success' };
      },
    };

    // `DAGDeriver.derive` runs `ContractRegistryValidator.validate` internally
    // and throws at derivation time when a hardRequired path is dangling.
    // The entrypoint's hardRequired is exempt (treated as initial state), so
    // we put the dangling read on nodeB and use nodeA as the entrypoint.
    assert.throws(
      () => DAGDeriver.derive({
        name:       'broken-test',
        version:    '1.0',
        entrypoint: 'broken:nodeA',
        nodes:      [nodeA, nodeB],
        annotations: {
          terminals: {
            'broken:nodeA': [{ outcome: 'success', target: 'broken:nodeB' }],
            'broken:nodeB': [{ outcome: 'success', target: null }],
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

  // ─── Test 3: dead-write warnings reach onContractWarning ──────────────────

  it('dead-write warnings reach RipperDagonizer.onContractWarning', () => {
    // entrypoint produces 'unused', no consumer ⇒ dead write.
    const entryNode: NodeInterface<ScrapeState, 'success', RipperServices> = {
      name:    'dead-write:entry',
      outputs: ['success'] as const,
      contract: {
        hardRequired: [] as const,
        produces:     ['unused-field'] as const,
      } satisfies OperationContractFragment,
      async execute(
        _state: ScrapeState,
        _ctx:   NodeContextInterface<RipperServices>,
      ): Promise<{ output: 'success' }> {
        return { output: 'success' };
      },
    };

    const tailNode: NodeInterface<ScrapeState, 'success', RipperServices> = {
      name:    'dead-write:tail',
      outputs: ['success'] as const,
      contract: {
        hardRequired: [] as const,
        produces:     [] as const,
      } satisfies OperationContractFragment,
      async execute(
        _state: ScrapeState,
        _ctx:   NodeContextInterface<RipperServices>,
      ): Promise<{ output: 'success' }> {
        return { output: 'success' };
      },
    };

    const dag = DAGDeriver.derive({
      name:       'dead-write-test',
      version:    '1.0',
      entrypoint: 'dead-write:entry',
      nodes:      [entryNode, tailNode],
      annotations: {
        terminals: {
          'dead-write:entry': [{ outcome: 'success', target: 'dead-write:tail' }],
          'dead-write:tail':  [{ outcome: 'success', target: null }],
        },
      },
    });

    const dispatcher = new RipperDagonizer<ScrapeState>({
      services: buildServices(),
      collectContractWarnings: true,
    });
    dispatcher.registerNode(entryNode);
    dispatcher.registerNode(tailNode);
    dispatcher.registerDAG(dag);

    const warnings = dispatcher.contractWarnings();
    assert.ok(
      warnings.length >= 1,
      `expected at least one dead-write warning, got ${warnings.length.toString()}`,
    );
    assert.ok(
      warnings.some((m) => m.includes('unused-field')),
      `expected warning mentioning 'unused-field', got:\n  ${warnings.join('\n  ')}`,
    );
  });
});
