import AjvModule, { type Ajv as AjvType, type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';
import type { FromSchema } from 'json-schema-to-ts';

// AJV 8.x ships dual CJS/ESM; under NodeNext the runtime default lives on `.default`.
type AjvCtorType = new (opts?: ConstructorParameters<typeof AjvType>[0]) => AjvType;
type AddFormatsFnType = (ajv: AjvType) => AjvType;

const Ajv        = (AjvModule        as unknown as { default?: AjvCtorType }).default        ?? (AjvModule        as unknown as AjvCtorType);
const addFormats = (addFormatsModule as unknown as { default?: AddFormatsFnType }).default ?? (addFormatsModule as unknown as AddFormatsFnType);

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

// RipperConfigInterface is the public type — exported from src/types/config.ts.
// Defined here for use by the validator; consumers should import from types/config.js.
type RipperConfigInterface = FromSchema<typeof RIPPER_CONFIG_SCHEMA>;

const ajv = new Ajv({ allErrors: true, strict: true, useDefaults: false });
addFormats(ajv);

class RipperConfigValidator {
  private constructor() { /* static-only */ }

  private static readonly _validate: ValidateFunction<RipperConfigInterface> =
    ajv.compile<RipperConfigInterface>(RIPPER_CONFIG_SCHEMA);

  public static validate(data: unknown): boolean {
    return RipperConfigValidator._validate(data);
  }

  public static formatErrors(): string {
    return ajv.errorsText(RipperConfigValidator._validate.errors, { separator: '\n  ' });
  }
}

/**
 * AJV type-guard for RipperConfigInterface.
 *
 * @param data - Unknown value to validate.
 * @returns `true` when `data` satisfies the RipperConfig schema.
 */
export const validateRipperConfig = (data: unknown): boolean =>
  RipperConfigValidator.validate(data);

/**
 * Formats the last AJV validation errors as a newline-separated string.
 *
 * @returns Human-readable description of all schema violations.
 */
export function formatRipperConfigErrors(): string { return RipperConfigValidator.formatErrors(); }
