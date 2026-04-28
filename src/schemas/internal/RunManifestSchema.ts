import AjvModule, { type Ajv as AjvType, type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';
import type { FromSchema } from 'json-schema-to-ts';

type AjvCtor = new (opts?: ConstructorParameters<typeof AjvType>[0]) => AjvType;
type AddFormatsFn = (ajv: AjvType) => AjvType;

const Ajv        = (AjvModule        as unknown as { default?: AjvCtor }).default        ?? (AjvModule        as unknown as AjvCtor);
const addFormats = (addFormatsModule as unknown as { default?: AddFormatsFn }).default ?? (addFormatsModule as unknown as AddFormatsFn);

export const RUN_MANIFEST_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://ripperoni.dev/schemas/internal/run-manifest.schema.json',
  title: 'RunManifest',
  type: 'object',
  additionalProperties: false,
  required: ['targetId', 'kind', 'runId', 'startedAt', 'completedAt', 'count', 'ids', 'schemaVersion'],
  properties: {
    targetId:      { type: 'string', minLength: 1 },
    kind:          { type: 'string', enum: ['html', 'mediawiki', 'crawler'] },
    runId:         { type: 'string', minLength: 1 },
    startedAt:     { type: 'string', format: 'date-time' },
    completedAt:   { type: 'string', format: 'date-time' },
    schemaVersion: { type: 'string', minLength: 1 },
    count:         { type: 'integer', minimum: 0 },
    ids:           { type: 'array', items: { type: 'string', minLength: 1 } },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['url', 'message'],
        properties: {
          url:     { type: 'string', minLength: 1 },
          message: { type: 'string', minLength: 1 },
        },
      },
    },
  },
} as const;

export type RunManifestInterface = FromSchema<typeof RUN_MANIFEST_SCHEMA>;

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);

export const validateRunManifest: ValidateFunction<RunManifestInterface> =
  ajv.compile<RunManifestInterface>(RUN_MANIFEST_SCHEMA);

export function formatRunManifestErrors(): string {
  return ajv.errorsText(validateRunManifest.errors, { separator: '\n  ' });
}
