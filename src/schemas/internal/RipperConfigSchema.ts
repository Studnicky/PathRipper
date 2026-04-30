import AjvModule, { type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';

import type { AjvCtorType, AddFormatsFnInterface } from '../../types/AjvInterop.js';
import type { ValidateResult } from '../../types/Results.js';

// AJV 8.x ships dual CJS/ESM; under NodeNext the runtime default lives on `.default`.
const Ajv        = (AjvModule        as unknown as { default?: AjvCtorType }).default        ?? (AjvModule        as unknown as AjvCtorType);
const addFormats = (addFormatsModule as unknown as { default?: AddFormatsFnInterface }).default ?? (addFormatsModule as unknown as AddFormatsFnInterface);

const JSON_SCHEMA_DRAFT_07_URI = 'http://json-schema.org/draft-07/schema#';

const SCHEMA = {
  $schema: JSON_SCHEMA_DRAFT_07_URI,
  $id: 'https://ripperoni.dev/schemas/internal/ripper-config.schema.json',
  title: 'RipperConfig',
  type: 'object',
  additionalProperties: false,
  required: ['output'],
  properties: {
    output: {
      type: 'object',
      additionalProperties: false,
      required: ['basePath'],
      properties: {
        basePath: { type: 'string', minLength: 1 },
        format:   { type: 'string', enum: ['json', 'html', 'text'] },
        pretty:   { type: 'boolean' },
      },
    },
    targets: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['baseUrl'],
        properties: {
          baseUrl:          { type: 'string', format: 'uri', minLength: 1 },
          rateLimitMs:      { type: 'integer', minimum: 0 },
          jitterMs:         { type: 'integer', minimum: 0 },
          maxRetries:       { type: 'integer', minimum: 0, maximum: 10 },
          retryBaseDelayMs: { type: 'integer', minimum: 100 },
          retryMaxDelayMs:  { type: 'integer', minimum: 1000 },
          headers: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
          outputSchema:  { type: 'string', minLength: 1 },
          onSchemaError: { type: 'string', enum: ['halt', 'skip', 'warn'] },
          mapping: {
            type: 'object',
            additionalProperties: { type: 'string', minLength: 1 },
          },
          tasks: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    mediawiki: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['apiUrl'],
        properties: {
          apiUrl:           { type: 'string', format: 'uri', minLength: 1 },
          rateLimitMs:      { type: 'integer', minimum: 0 },
          jitterMs:         { type: 'integer', minimum: 0 },
          batchSize:        { type: 'integer', minimum: 1, maximum: 50 },
          allPagesLimit:    { type: 'integer', minimum: 1, maximum: 500 },
          maxRetries:       { type: 'integer', minimum: 0, maximum: 10 },
          retryBaseDelayMs: { type: 'integer', minimum: 100 },
          retryMaxDelayMs:  { type: 'integer', minimum: 1000 },
          outputSchema:  { type: 'string', minLength: 1 },
          onSchemaError: { type: 'string', enum: ['halt', 'skip', 'warn'] },
          mapping: {
            type: 'object',
            additionalProperties: { type: 'string', minLength: 1 },
          },
          categories: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
          },
          tasks: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    crawlers: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['startUrls', 'domain', 'target', 'delimiter'],
        properties: {
          startUrls: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', format: 'uri', minLength: 1 },
          },
          domain:      { type: 'string', minLength: 1 },
          target:      { type: 'string', minLength: 1 },
          delimiter:   { type: 'string', minLength: 1 },
          rateLimitMs: { type: 'integer', minimum: 0 },
          jitterMs:    { type: 'integer', minimum: 0 },
          maxPages:    { type: 'integer', minimum: 1 },
        },
      },
    },
  },
} as const;

const ajv = new Ajv({ allErrors: true, strict: true, useDefaults: false });
addFormats(ajv);

/**
 * Provides AJV-based validation for the ripperoni configuration file.
 *
 * @remarks
 * All methods and properties are static. The `SCHEMA` property exposes the raw
 * JSON Schema Draft-07 object for use in type derivation.
 *
 * @example
 * ```ts
 * const errors = RipperConfigSchema.validate(rawJson);
 * if (errors !== null) throw new Error(errors);
 * ```
 * @category Schema
 * @since 2.0.0
 * @group Schema
 * @see RipperConfigInterface
 */
export class RipperConfigSchema {
  private constructor() { /* static-only */ }

  /** JSON Schema Draft-07 definition for the ripperoni configuration file. */
  public static readonly SCHEMA: typeof SCHEMA = SCHEMA;

  private static readonly _validate: ValidateFunction<object> =
    ajv.compile(SCHEMA);

  /**
   * Validates data against the RipperConfig schema.
   *
   * @param data - Unknown value to validate.
   * @returns `null` when `data` is valid; a human-readable error string otherwise.
   */
  public static validate(data: unknown): ValidateResult {
    if (RipperConfigSchema._validate(data as object)) return null;
    return ajv.errorsText(RipperConfigSchema._validate.errors, { separator: '\n  ' });
  }
}
