// Typecheck-only test for `setConceptOutput` + `satisfies` guarantees on
// assembled output literals.
//
// This file is NOT a runtime test. It is compiled by `tsc --noEmit` via the
// dedicated `tsconfig.typecheck.json`. Each `@ts-expect-error` line asserts
// that the corresponding misspelled-key pattern fails at compile time;
// `tsc` fails the suite if the error does not actually surface.
//
// Run via: `npm run typecheck:tests`.
import { ScrapeState } from '../../src/state/ScrapeState.js';
import { setConceptOutput } from '../../plugins/aonprd/concepts/_helpers.js';
import type { ConceptDecl, ConceptOutputUnion, ConceptOutputFor } from '../../plugins/aonprd/taxonomy.js';

// ─── Stub output types ──────────────────────────────────────────────────────

type StubLanguageOutput = {
  readonly _type: 'language';
  readonly url: string;
  readonly name: string;
  readonly script: string | null;
}

type StubMonsterOutput = {
  readonly _type: 'monster';
  readonly url: string;
  readonly name: string;
  readonly hp: number;
}

// ─── Positive case: well-typed assembled literal ────────────────────────────
// Demonstrates the intended API — assembled literal carries a `satisfies`
// clause matching the concept's output type, then `setConceptOutput` merges
// it into `state.output`.

const stateOk = new ScrapeState();
const assembledOk = {
  _type: 'language' as const,
  url:   'https://example.test/Languages.aspx?ID=1',
  name:  'Common',
  script: 'Common',
} satisfies StubLanguageOutput;
setConceptOutput(stateOk, assembledOk);

// ─── Negative case 1 — misspelled key in literal ────────────────────────────
const stateBad1 = new ScrapeState();
const assembledBad1 = {
  _type: 'language' as const,
  url:   'https://example.test/Languages.aspx?ID=1',
  name:  'Common',
  // @ts-expect-error misspelled key 'scrip' (should be 'script')
  scrip: 'Common',
} satisfies StubLanguageOutput;
setConceptOutput(stateBad1, assembledBad1);

// ─── Negative case 2 — missing required key ─────────────────────────────────
const assembledBad2 = {
  _type: 'language' as const,
  url:   'https://example.test/Languages.aspx?ID=1',
  name:  'Common',
// @ts-expect-error missing required key 'script'
} satisfies StubLanguageOutput;
const stateBad2 = new ScrapeState();
setConceptOutput(stateBad2, assembledBad2);

// ─── Negative case 3 — wrong literal discriminator ──────────────────────────
const assembledBad3 = {
  // @ts-expect-error discriminator value not in LanguageOutput's `_type` union
  _type: 'monster' as const,
  url:   'https://example.test/Languages.aspx?ID=1',
  name:  'Common',
  script: 'Common',
} satisfies StubLanguageOutput;
const stateBad3 = new ScrapeState();
setConceptOutput(stateBad3, assembledBad3);

// ─── Derived ConceptOutputUnion ─────────────────────────────────────────────
// Confirm the union recovers from a stub taxonomy declaration.

const stubLangConcept: ConceptDecl<StubLanguageOutput> = {
  id: 'stub-language',
  parent: null,
  capabilities: [],
};

const stubMonsterConcept: ConceptDecl<StubMonsterOutput> = {
  id: 'stub-monster',
  parent: null,
  capabilities: [],
};

// Interior concept with default TOutput (`never`) — contributes nothing to the union.
const stubInteriorConcept: ConceptDecl = {
  id: 'stub-interior',
  parent: null,
  capabilities: [],
};

const STUB_TAXONOMY = [
  stubInteriorConcept,
  stubLangConcept,
  stubMonsterConcept,
] as const satisfies readonly ConceptDecl<unknown>[];

type StubUnion = ConceptOutputUnion<typeof STUB_TAXONOMY>;

// StubUnion should be StubLanguageOutput | StubMonsterOutput.
const url1: StubUnion = {
  _type: 'language',
  url:   'x',
  name:  'y',
  script: null,
};

const url2: StubUnion = {
  _type: 'monster',
  url:   'x',
  name:  'y',
  hp:    10,
};

// @ts-expect-error literal does not match any union member
const uBad: StubUnion = { foo: 'bar' };

// ConceptOutputFor recovers a single concept's output type.
type LangOut = ConceptOutputFor<typeof stubLangConcept>;
const langOut: LangOut = {
  _type: 'language',
  url:   'x',
  name:  'y',
  script: null,
};

// Reference exports so unused-locals does not mask the @ts-expect-error
// markers above.
export const _exports = { url1, url2, uBad, langOut, STUB_TAXONOMY };
