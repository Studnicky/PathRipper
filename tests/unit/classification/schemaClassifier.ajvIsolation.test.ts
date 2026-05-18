/**
 * @fileoverview Logi follow-up sentinel — documents what happens when two
 * plugins sharing `ctx.ajv` (the run-wide shared AJV instance from
 * `context:ajv`) attempt to compile schemas with overlapping `$id` values.
 *
 * @remarks
 * The v0.7.0 silo migration moves every plugin off private AJV instances and
 * onto the shared `ctx.ajv`. The new {@link SchemaClassifier} plugin path
 * (task #15) compiles user-loaded JSON Schemas via `ctx.ajv.compile(...)`.
 * That puts user-loaded schemas onto the same AJV registry as every other
 * plugin's compile (config validation, future custom keywords). If two
 * compiles supply the same `$id`, AJV's behaviour determines the failure
 * mode for downstream users.
 *
 * This test pins that behaviour: AJV 8.x with `strict: true` rejects the
 * second compile with a clean `Error` containing `"schema with key or id"`
 * and `"already exists"`. The first validator is unaffected and continues to
 * function correctly. The two compilations therefore do NOT land in
 * isolated scopes — they share one global registry, and the second one
 * fails fast.
 *
 * The test exists to make a future `$id` collision a deliberate decision:
 * the test will fail loudly if AJV's behaviour ever changes (e.g. a future
 * release allows silent overwrite), forcing the maintainer to update the
 * documented contract for user-loaded schemas.
 *
 * @category Classification
 * @since 0.7.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import AjvModule       from 'ajv';
import addFormatsModule from 'ajv-formats';

import type { AjvCtorType, AddFormatsFnInterface } from '../../../src/types/AjvInterop.js';

// ── AJV 8.x dual-CJS/ESM unwrap (matches src/context/ajv.ts) ─────────────────

const Ajv        = (AjvModule        as unknown as { default?: AjvCtorType }).default        ?? (AjvModule        as unknown as AjvCtorType);
const addFormats = (addFormatsModule as unknown as { default?: AddFormatsFnInterface }).default ?? (addFormatsModule as unknown as AddFormatsFnInterface);

// ── Shared $id used by both "plugins" ────────────────────────────────────────

const SHARED_ID = 'https://example.org/foo' as const;

const pluginASchema = {
  $id:        SHARED_ID,
  type:       'object',
  properties: { a: { type: 'number' } },
  required:   ['a'],
  additionalProperties: true,
} as const;

const pluginBSchema = {
  $id:        SHARED_ID,
  type:       'object',
  properties: { b: { type: 'string' } },
  required:   ['b'],
  additionalProperties: true,
} as const;

// ── Sentinel ──────────────────────────────────────────────────────────────────

describe('shared ctx.ajv — $id collision boundary (logi follow-up sentinel)', () => {
  it('AJV throws a clean "duplicate $id" error on the second compile and does NOT isolate scopes', () => {
    // Fresh AJV mirrors the construction in `src/context/ajv.ts`.
    const ajv = new Ajv({ allErrors: true, strict: true, useDefaults: false });
    addFormats(ajv);

    // Plugin A compiles first. Succeeds and returns a validator.
    const validateA = ajv.compile(pluginASchema);
    assert.equal(typeof validateA, 'function');
    assert.equal(validateA({ a: 1 }), true,  'A validates {a:1} pre-collision');
    assert.equal(validateA({ b: 'x' }), false, 'A rejects {b:"x"} pre-collision');

    // Plugin B (the SchemaClassifier under test) tries to compile a different
    // schema body under the same $id. AJV must throw — this is the documented
    // collision boundary.
    let thrown: unknown;
    try {
      ajv.compile(pluginBSchema);
    } catch (err) {
      thrown = err;
    }

    assert.ok(thrown !== undefined, 'AJV must throw on duplicate $id');
    assert.ok(thrown instanceof Error, 'thrown value is an Error');
    const message = (thrown as Error).message;
    assert.match(
      message,
      /schema with key or id ".*" already exists/i,
      `expected duplicate-$id error; got: ${message}`,
    );
    assert.ok(
      message.includes(SHARED_ID),
      `error must reference the colliding $id "${SHARED_ID}"; got: ${message}`,
    );

    // Plugin A's validator is untouched after the failed B compile. The two
    // compilations do NOT live in isolated scopes — there is exactly one
    // schema registry on the shared instance, and the conflict is resolved
    // by rejection rather than by partition.
    assert.equal(validateA({ a: 1 }),  true,  'A still validates {a:1} after B failed');
    assert.equal(validateA({ b: 'x' }), false, 'A still rejects {b:"x"} after B failed');
  });

  it('the same AJV instance permits non-colliding $id compiles to coexist', () => {
    // Negative-control sibling: confirms the registry only rejects on the
    // exact $id collision, not on every second compile.
    const ajv = new Ajv({ allErrors: true, strict: true, useDefaults: false });
    addFormats(ajv);

    const validateA = ajv.compile({
      $id:        'https://example.org/a',
      type:       'object',
      properties: { a: { type: 'number' } },
      required:   ['a'],
    });
    const validateC = ajv.compile({
      $id:        'https://example.org/c',
      type:       'object',
      properties: { c: { type: 'boolean' } },
      required:   ['c'],
    });

    assert.equal(validateA({ a: 1 }),    true);
    assert.equal(validateC({ c: true }), true);
    assert.equal(validateA({ c: true }), false);
    assert.equal(validateC({ a: 1 }),    false);
  });

  it('omitting $id sidesteps the registry — anonymous schemas always coexist', () => {
    // The contract for user-loaded schemas: if you cannot guarantee unique
    // $ids, omit them. Anonymous schemas are stored only on the returned
    // ValidateFunction, never in the global registry.
    const ajv = new Ajv({ allErrors: true, strict: true, useDefaults: false });
    addFormats(ajv);

    const v1 = ajv.compile({
      type:       'object',
      properties: { a: { type: 'number' } },
      required:   ['a'],
    });
    const v2 = ajv.compile({
      type:       'object',
      properties: { b: { type: 'string' } },
      required:   ['b'],
    });

    assert.notEqual(v1, v2, 'anonymous compiles produce distinct validators');
    assert.equal(v1({ a: 1 }),    true);
    assert.equal(v2({ b: 'x' }),  true);
    assert.equal(v1({ b: 'x' }),  false);
    assert.equal(v2({ a: 1 }),    false);
  });
});
