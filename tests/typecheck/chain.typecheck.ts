// Typecheck-only test for `chain()` compile-time validation.
//
// This file is NOT a runtime test. It is compiled by `tsc --noEmit` via the
// dedicated `tsconfig.typecheck.json`. Each `@ts-expect-error` line asserts
// that `chain()` rejects the corresponding broken chain at compile time;
// `tsc` fails the suite if the error does not actually surface.
//
// Run via: `npm run typecheck:tests`.
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';

import type { ScrapeState }    from '../../src/state/ScrapeState.js';
import type { RipperServices } from '../../src/services/RipperServices.js';
import { chain } from '../../plugins/aonprd/taxonomy.js';
import { loadAndCommonNode }   from '../../plugins/aonprd/nodes/loadAndCommon.js';
import { labelPairBlockNode }  from '../../plugins/aonprd/capabilities/labelPairBlock.js';

// ─── Stub capabilities with literal-tuple contracts ─────────────────────────

const producesAlpha = {
  name: 'test:produces-alpha',
  outputs: ['success'] as const,
  contract: {
    hardRequired: [] as const,
    produces:     ['alpha'] as const,
  } satisfies OperationContractFragment,
  async execute(
    _state: ScrapeState,
    _ctx:   NodeContextInterface<RipperServices>,
  ): Promise<{ output: 'success' }> {
    return { output: 'success' };
  },
} satisfies NodeInterface<ScrapeState, 'success', RipperServices>;

const readsAlphaProducesBeta = {
  name: 'test:reads-alpha-produces-beta',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['alpha'] as const,
    produces:     ['beta'] as const,
  } satisfies OperationContractFragment,
  async execute(
    _state: ScrapeState,
    _ctx:   NodeContextInterface<RipperServices>,
  ): Promise<{ output: 'success' }> {
    return { output: 'success' };
  },
} satisfies NodeInterface<ScrapeState, 'success', RipperServices>;

const readsBetaProducesGamma = {
  name: 'test:reads-beta-produces-gamma',
  outputs: ['success'] as const,
  contract: {
    hardRequired: ['beta'] as const,
    produces:     ['gamma'] as const,
  } satisfies OperationContractFragment,
  async execute(
    _state: ScrapeState,
    _ctx:   NodeContextInterface<RipperServices>,
  ): Promise<{ output: 'success' }> {
    return { output: 'success' };
  },
} satisfies NodeInterface<ScrapeState, 'success', RipperServices>;

const readsMissingFieldNode = {
  name: 'test:reads-missing-field',
  outputs: ['success'] as const,
  contract: {
    // Reads a field that the predecessor in the broken chain does not produce.
    hardRequired: ['no-one-produces-this'] as const,
    produces:     [] as const,
  } satisfies OperationContractFragment,
  async execute(
    _state: ScrapeState,
    _ctx:   NodeContextInterface<RipperServices>,
  ): Promise<{ output: 'success' }> {
    return { output: 'success' };
  },
} satisfies NodeInterface<ScrapeState, 'success', RipperServices>;

// ─── Positive case ─────────────────────────────────────────────────────────
// Valid chain: each predecessor's `produces` covers the successor's
// `hardRequired`. Compiles cleanly — no @ts-expect-error.
const validChain = chain(
  producesAlpha,
  readsAlphaProducesBeta,
  readsBetaProducesGamma,
);
// Reference the binding so it isn't a dead store under noUnusedLocals.
export const _validChainSize = validChain.length;

// ─── Negative case 1 — broken pair at the start ────────────────────────────
// `readsMissingFieldNode` hardRequires `'no-one-produces-this'`, which
// `producesAlpha.contract.produces` does not include. The broken successor
// argument is required to be `never`, so the call must fail at that
// argument's line with TS2345.
const _brokenStart = chain(
  producesAlpha,
  // @ts-expect-error broken chain pair (producesAlpha → readsMissingFieldNode)
  readsMissingFieldNode,
);

// ─── Negative case 2 — broken pair mid-chain ───────────────────────────────
// First pair (producesAlpha → readsAlphaProducesBeta) is fine, but second
// pair (readsAlphaProducesBeta → readsMissingFieldNode) is broken because
// `readsAlphaProducesBeta.produces` is `['beta']`, not `['no-one-produces-this']`.
const _brokenMid = chain(
  producesAlpha,
  readsAlphaProducesBeta,
  // @ts-expect-error broken chain pair (readsAlphaProducesBeta → readsMissingFieldNode)
  readsMissingFieldNode,
);

// Reference unused locals so noUnusedLocals/noUnusedParameters do not mask
// the @ts-expect-error placement.
export const _exports = { _brokenStart, _brokenMid };

// ─── Live-node smoke test ─────────────────────────────────────────────────
// Exercise `chain()` against real capability nodes from the AONPRD plugin to
// confirm the helper accepts the contract shapes those nodes actually carry.
// The chain `loadAndCommonNode → labelPairBlockNode` is the canonical pair —
// `loadAndCommonNode` produces `aonprdCommon`, `labelPairBlockNode`
// `hardRequires` it. Must compile cleanly.
const _liveChain = chain(loadAndCommonNode, labelPairBlockNode);
export const _liveChainLen = _liveChain.length;
