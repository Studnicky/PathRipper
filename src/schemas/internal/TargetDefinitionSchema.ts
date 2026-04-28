import AjvModule, { type Ajv as AjvType, type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';
import type { FromSchema } from 'json-schema-to-ts';

type AjvCtorType = new (opts?: ConstructorParameters<typeof AjvType>[0]) => AjvType;
type AddFormatsFnType = (ajv: AjvType) => AjvType;

const Ajv        = (AjvModule        as unknown as { default?: AjvCtorType }).default        ?? (AjvModule        as unknown as AjvCtorType);
const addFormats = (addFormatsModule as unknown as { default?: AddFormatsFnType }).default ?? (addFormatsModule as unknown as AddFormatsFnType);

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

export class TargetDefinitionValidator {
  private constructor() { /* static-only */ }

  private static readonly _validate: ValidateFunction<TargetDefinitionInterface> =
    ajv.compile<TargetDefinitionInterface>(TARGET_DEFINITION_SCHEMA);

  public static validate(data: unknown): data is TargetDefinitionInterface {
    return TargetDefinitionValidator._validate(data);
  }

  public static formatErrors(): string {
    return ajv.errorsText(TargetDefinitionValidator._validate.errors, { separator: '\n  ' });
  }
}

export const validateTargetDefinition = TargetDefinitionValidator.validate.bind(TargetDefinitionValidator);
export function formatTargetDefinitionErrors(): string { return TargetDefinitionValidator.formatErrors(); }
