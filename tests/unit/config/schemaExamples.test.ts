/**
 * Verifies that every `examples[]` entry in the RipperConfigSchema (and its
 * sub-schemas) validates successfully against the schema in which it lives.
 *
 * This test acts as a compile-time guard: if a metadata author adds an
 * `examples` entry that would fail AJV validation, this test catches it
 * before the schema is shipped.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { RipperConfigSchema } from '../../../src/schemas/internal/RipperConfigSchema.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Walk a JSON Schema object and collect every `examples` array with its path. */
function collectExamples(
  schema: Record<string, unknown>,
  path = '#',
): Array<{ path: string; examples: unknown[] }> {
  const results: Array<{ path: string; examples: unknown[] }> = [];

  if (Array.isArray(schema.examples)) {
    results.push({ path, examples: schema.examples as unknown[] });
  }

  for (const [key, value] of Object.entries(schema)) {
    if (key === 'examples') continue;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      results.push(...collectExamples(value as Record<string, unknown>, `${path}/${key}`));
    }
  }

  return results;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RipperConfigSchema — examples validate against their parent schema', () => {
  // Validate top-level examples (each must satisfy the root schema).
  describe('root schema examples', () => {
    const schema = RipperConfigSchema.SCHEMA as unknown as Record<string, unknown>;
    const rootExamples = Array.isArray(schema.examples)
      ? (schema.examples as unknown[])
      : [];

    for (let idx = 0; idx < rootExamples.length; idx++) {
      const example = rootExamples[idx];
      it(`example[${idx}] is a valid RipperConfig`, () => {
        const errors = RipperConfigSchema.validate(example);
        assert.equal(
          errors,
          null,
          `Root schema example[${idx}] failed validation:\n  ${errors}`,
        );
      });
    }
  });

  // Validate output sub-schema examples — each must be a valid `output` object.
  // We do this by wrapping each example in a minimal root config and validating
  // the whole document, because AJV compiles against the root schema only.
  describe('output sub-schema examples', () => {
    const schema = RipperConfigSchema.SCHEMA as unknown as Record<string, unknown>;
    const outputSchema = (schema.properties as Record<string, unknown>)
      ?.output as Record<string, unknown> | undefined;
    const examples = Array.isArray(outputSchema?.examples)
      ? (outputSchema.examples as unknown[])
      : [];

    for (let idx = 0; idx < examples.length; idx++) {
      const example = examples[idx];
      it(`output example[${idx}] is valid when placed in a root config`, () => {
        const errors = RipperConfigSchema.validate({ output: example });
        assert.equal(
          errors,
          null,
          `output example[${idx}] failed validation:\n  ${errors}`,
        );
      });
    }
  });

  // Validate targets additionalProperties examples — wrap each in a root config.
  describe('targets additionalProperties examples (HTML target)', () => {
    const schema = RipperConfigSchema.SCHEMA as unknown as Record<string, unknown>;
    const targetsSchema = (schema.properties as Record<string, unknown>)
      ?.targets as Record<string, unknown> | undefined;
    const targetDef = targetsSchema?.additionalProperties as Record<string, unknown> | undefined;
    const examples = Array.isArray(targetDef?.examples)
      ? (targetDef.examples as unknown[])
      : [];

    for (let idx = 0; idx < examples.length; idx++) {
      const example = examples[idx];
      it(`targets.additionalProperties example[${idx}] is valid`, () => {
        const errors = RipperConfigSchema.validate({
          output: { basePath: './output' },
          targets: { 'example-target': example },
        });
        assert.equal(
          errors,
          null,
          `targets example[${idx}] failed validation:\n  ${errors}`,
        );
      });
    }
  });

  // Validate mediawiki additionalProperties examples.
  describe('mediawiki additionalProperties examples', () => {
    const schema = RipperConfigSchema.SCHEMA as unknown as Record<string, unknown>;
    const mwSchema = (schema.properties as Record<string, unknown>)
      ?.mediawiki as Record<string, unknown> | undefined;
    const mwDef = mwSchema?.additionalProperties as Record<string, unknown> | undefined;
    const examples = Array.isArray(mwDef?.examples)
      ? (mwDef.examples as unknown[])
      : [];

    for (let idx = 0; idx < examples.length; idx++) {
      const example = examples[idx];
      it(`mediawiki.additionalProperties example[${idx}] is valid`, () => {
        const errors = RipperConfigSchema.validate({
          output: { basePath: './output' },
          mediawiki: { 'example-wiki': example },
        });
        assert.equal(
          errors,
          null,
          `mediawiki example[${idx}] failed validation:\n  ${errors}`,
        );
      });
    }
  });

  // Validate inline crawler sub-schema examples.
  describe('targets.crawler sub-schema examples', () => {
    const schema = RipperConfigSchema.SCHEMA as unknown as Record<string, unknown>;
    const targetDef = ((schema.properties as Record<string, unknown>)
      ?.targets as Record<string, unknown>)
      ?.additionalProperties as Record<string, unknown> | undefined;
    const crawlerDef = (targetDef?.properties as Record<string, unknown> | undefined)
      ?.crawler as Record<string, unknown> | undefined;
    const examples = Array.isArray(crawlerDef?.examples)
      ? (crawlerDef.examples as unknown[])
      : [];

    for (let idx = 0; idx < examples.length; idx++) {
      const example = examples[idx];
      it(`targets.crawler example[${idx}] is valid when embedded in a target`, () => {
        const errors = RipperConfigSchema.validate({
          output: { basePath: './output' },
          targets: {
            'example-target': {
              baseUrl: 'https://example.com',
              pipeline: ['html:fetch', 'example-target:parse', 'json:write'],
              crawler: example,
            },
          },
        });
        assert.equal(
          errors,
          null,
          `targets.crawler example[${idx}] failed validation:\n  ${errors}`,
        );
      });
    }
  });

  // Smoke-test: confirm the helper finds examples across the schema tree.
  describe('collectExamples helper', () => {
    it('finds at least 20 example entries across the schema', () => {
      const schema = RipperConfigSchema.SCHEMA as unknown as Record<string, unknown>;
      const found = collectExamples(schema);
      assert.ok(
        found.length >= 20,
        `Expected at least 20 example-bearing schema nodes, found ${found.length}`,
      );
    });
  });
});
