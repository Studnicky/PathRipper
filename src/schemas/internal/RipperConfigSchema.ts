import AjvModule, { type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';
import type { FromSchema } from 'json-schema-to-ts';

import type { AjvCtorType, AddFormatsFnInterface } from '../../types/AjvInterop.js';

// AJV 8.x ships dual CJS/ESM; under NodeNext the runtime default lives on `.default`.
const Ajv        = (AjvModule        as unknown as { default?: AjvCtorType }).default        ?? (AjvModule        as unknown as AjvCtorType);
const addFormats = (addFormatsModule as unknown as { default?: AddFormatsFnInterface }).default ?? (addFormatsModule as unknown as AddFormatsFnInterface);

const JSON_SCHEMA_DRAFT_07_URI = 'http://json-schema.org/draft-07/schema#';

/** JSON Schema Draft-07 definition for the ripperoni configuration file. */
export const RIPPER_CONFIG_SCHEMA = {
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
          baseUrl:     { type: 'string', format: 'uri', minLength: 1 },
          rateLimitMs: { type: 'integer', minimum: 0 },
          jitterMs:    { type: 'integer', minimum: 0 },
          maxRetries:  { type: 'integer', minimum: 0 },
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
          apiUrl:      { type: 'string', format: 'uri', minLength: 1 },
          rateLimitMs: { type: 'integer', minimum: 0 },
          jitterMs:    { type: 'integer', minimum: 0 },
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

/** Validated ripperoni configuration derived from the JSON schema. */
type RipperConfigInterface = FromSchema<typeof RIPPER_CONFIG_SCHEMA>;

const ajv = new Ajv({ allErrors: true, strict: true, useDefaults: false });
addFormats(ajv);

class RipperConfigValidator {
  private constructor() { /* static-only */ }

  private static readonly _validate: ValidateFunction<RipperConfigInterface> =
    ajv.compile<RipperConfigInterface>(RIPPER_CONFIG_SCHEMA);

  public static validate(data: unknown): string | null {
    if (RipperConfigValidator._validate(data)) return null;
    return ajv.errorsText(RipperConfigValidator._validate.errors, { separator: '\n  ' });
  }
}

/**
 * Validates data against the RipperConfig schema.
 *
 * @param data - Unknown value to validate.
 * @returns `null` when `data` is valid; a human-readable error string otherwise.
 */
export const validateRipperConfig = (data: unknown): string | null =>
  RipperConfigValidator.validate(data);
