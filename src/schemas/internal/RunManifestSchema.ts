import AjvModule, { type Ajv as AjvType, type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';
import type { FromSchema } from 'json-schema-to-ts';

type AjvCtorType = new (opts?: ConstructorParameters<typeof AjvType>[0]) => AjvType;
type AddFormatsFnType = (ajv: AjvType) => AjvType;

const Ajv        = (AjvModule        as unknown as { default?: AjvCtorType }).default        ?? (AjvModule        as unknown as AjvCtorType);
const addFormats = (addFormatsModule as unknown as { default?: AddFormatsFnType }).default ?? (addFormatsModule as unknown as AddFormatsFnType);

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

export class RunManifestValidator {
  private constructor() { /* static-only */ }

  private static readonly _validate: ValidateFunction<RunManifestInterface> =
    ajv.compile<RunManifestInterface>(RUN_MANIFEST_SCHEMA);

  public static validate(data: unknown): data is RunManifestInterface {
    return RunManifestValidator._validate(data);
  }

  public static formatErrors(): string {
    return ajv.errorsText(RunManifestValidator._validate.errors, { separator: '\n  ' });
  }
}

export const validateRunManifest = RunManifestValidator.validate.bind(RunManifestValidator);
export function formatRunManifestErrors(): string { return RunManifestValidator.formatErrors(); }
