// Unit test for registerAllFlows.
//
// registerAllFlows populates a dispatcher with every built-in node and DAG.
// Each registerDAG runs the framework's schema + semantic gates, and the
// semantic gate validates that a scatter `{ dag }` body references a DAG that
// is already in the registry. This test exercises the full registration path
// against a real RipperDagonizer and asserts it completes without throwing —
// catching dependency-ordering regressions (e.g. a phase DAG with a `{ dag }`
// scatter body registered before its referenced per-page DAG).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { RipperDagonizer }       from '../../../src/dispatcher/RipperDagonizer.js';
import { registerAllFlows }      from '../../../src/flows/registerAllFlows.js';
import type { ScrapeState }      from '../../../src/state/ScrapeState.js';
import type { RipperServices }   from '../../../src/services/RipperServices.js';

describe('registerAllFlows', () => {
  it('registers every built-in node and DAG without throwing', () => {
    const dispatcher = new RipperDagonizer<ScrapeState>({
      services: {} as RipperServices,
    });

    assert.doesNotThrow(() => registerAllFlows(dispatcher));
  });
});
