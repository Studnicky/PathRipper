import AjvModule, { type Ajv as AjvType, type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';
import type { FromSchema } from 'json-schema-to-ts';

type AjvCtor = new (opts?: ConstructorParameters<typeof AjvType>[0]) => AjvType;
type AddFormatsFn = (ajv: AjvType) => AjvType;

const Ajv        = (AjvModule        as unknown as { default?: AjvCtor }).default        ?? (AjvModule        as unknown as AjvCtor);
const addFormats = (addFormatsModule as unknown as { default?: AddFormatsFn }).default ?? (addFormatsModule as unknown as AddFormatsFn);

export const TARGET_DEFINITION_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://ripperoni.dev/schemas/internal/target-definition.schema.json',
  title: 'TargetDefinition',
  type: 'object',
  additionalProperties: true,
  properties: {
    outputSchema:  { type: 'string', minLength: 1 },
    onSchemaError: { type: 'string', enum: ['halt', 'skip', 'warn'] },
    mapping: {
      type: 'object',
      additionalProperties: { type: 'string', minLength: 1 },
    },
  },
} as const;

export type TargetDefinitionInterface = FromSchema<typeof TARGET_DEFINITION_SCHEMA>;

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

export const validateTargetDefinition: ValidateFunction<TargetDefinitionInterface> =
  ajv.compile<TargetDefinitionInterface>(TARGET_DEFINITION_SCHEMA);

export function formatTargetDefinitionErrors(): string {
  return ajv.errorsText(validateTargetDefinition.errors, { separator: '\n  ' });
}
