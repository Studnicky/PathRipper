import AjvModule, { type Ajv as AjvType, type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';
import type { FromSchema } from 'json-schema-to-ts';

// AJV 8.x ships dual CJS/ESM; under NodeNext the runtime default lives on `.default`.
type AjvCtor = new (opts?: ConstructorParameters<typeof AjvType>[0]) => AjvType;
type AddFormatsFn = (ajv: AjvType) => AjvType;

const Ajv        = (AjvModule        as unknown as { default?: AjvCtor }).default        ?? (AjvModule        as unknown as AjvCtor);
const addFormats = (addFormatsModule as unknown as { default?: AddFormatsFn }).default ?? (addFormatsModule as unknown as AddFormatsFn);

export const RIPPER_CONFIG_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
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
        },
      },
    },
    mediawiki: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['apiUrl', 'userAgent'],
        properties: {
          apiUrl:      { type: 'string', format: 'uri', minLength: 1 },
          userAgent:   { type: 'string', minLength: 1 },
          rateLimitMs: { type: 'integer', minimum: 0 },
          categories: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
          outputSchema:  { type: 'string', minLength: 1 },
          onSchemaError: { type: 'string', enum: ['halt', 'skip', 'warn'] },
          mapping: {
            type: 'object',
            additionalProperties: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    crawlers: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['startUrl', 'domain', 'target', 'delimiter'],
        properties: {
          startUrl:    { type: 'string', format: 'uri', minLength: 1 },
          domain:      { type: 'string', minLength: 1 },
          target:      { type: 'string', minLength: 1 },
          delimiter:   { type: 'string', minLength: 1 },
          rateLimitMs: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
} as const;

export type RipperConfigInterface = FromSchema<typeof RIPPER_CONFIG_SCHEMA>;

const ajv = new Ajv({ allErrors: true, strict: true, useDefaults: false });
addFormats(ajv);

export const validateRipperConfig: ValidateFunction<RipperConfigInterface> =
  ajv.compile<RipperConfigInterface>(RIPPER_CONFIG_SCHEMA);

export function formatRipperConfigErrors(): string {
  return ajv.errorsText(validateRipperConfig.errors, { separator: '\n  ' });
}
