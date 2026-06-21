import { readFile } from 'node:fs/promises';

import AjvModule, { type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';

import { ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

import type { AjvCtorType, AddFormatsFnInterface } from '../types/AjvInterop.js';
import { ExternalSchemaError } from '../errors/ExternalSchemaError.js';
import { Logger }               from '../modules/logger/logger.js';
import { toNodeError }          from './fileUtils.js';
import type { ScrapeState }     from '../state/ScrapeState.js';
import type { RipperServices }  from '../services/RipperServices.js';

const Ajv        = (AjvModule        as unknown as { default?: AjvCtorType }).default
                  ?? (AjvModule      as unknown as AjvCtorType);
const addFormats = (addFormatsModule as unknown as { default?: AddFormatsFnInterface }).default
                  ?? (addFormatsModule as unknown as AddFormatsFnInterface);

const log = Logger.forComponent('ValidateSchemaNode');

/** Compiled AJV cache keyed by absolute schema path so repeated runs don't recompile. */
const COMPILED_VALIDATORS = new Map<string, ValidateFunction<unknown>>();

const compileSchema = async (schemaPath: string): Promise<ValidateFunction<unknown>> => {
  const existing = COMPILED_VALIDATORS.get(schemaPath);
  if (existing !== undefined) return existing;

  let raw: string;
  try {
    raw = await readFile(schemaPath, 'utf8');
  } catch (err) {
    throw ExternalSchemaError.create(`Could not read schema file: ${schemaPath}`, {
      cause: err instanceof Error ? err : undefined,
      metadata: { schemaPath },
    });
  }

  let schema: unknown;
  try {
    schema = JSON.parse(raw);
  } catch (err) {
    throw ExternalSchemaError.create(`Schema file is not valid JSON: ${schemaPath}`, {
      cause: err instanceof Error ? err : undefined,
      metadata: { schemaPath },
    });
  }

  const ajv = new Ajv({ allErrors: true, strict: false, useDefaults: false });
  addFormats(ajv);
  const validator = ajv.compile<unknown>(schema as object);
  COMPILED_VALIDATORS.set(schemaPath, validator);
  return validator;
};

type ValidateSchemaOutput = 'valid' | 'invalid';

/**
 * Validates `state.output` against the JSON schema at `services.outputSchema`.
 * No-op when `outputSchema` is unset.
 *
 * Output ports:
 * - `valid`   — output passed validation (or no schema configured).
 * - `invalid` — output failed schema validation; error recorded on state.
 *
 * @category Nodes
 * @since 3.0.0
 */
class ValidateSchemaNodeImpl extends ScalarNode<ScrapeState, ValidateSchemaOutput, RipperServices> {
  public readonly name = 'validate:schema';
  public readonly outputs = ['valid', 'invalid'] as const;

  public override get outputSchema(): Record<ValidateSchemaOutput, SchemaObjectType> {
    return {
      // `valid` — `state.output` passed AJV validation (or no schema configured); no state delta.
      valid: { type: 'object' },
      // `invalid` — validation failed; error recorded on state via collectError; no other delta.
      invalid: { type: 'object' },
    };
  }

  protected override async executeOne(
    state:   ScrapeState,
    context: NodeContextType<RipperServices>,
  ): Promise<NodeOutputType<ValidateSchemaOutput>> {
    const { services } = context;
    const schemaPath = services.outputSchema;
    if (schemaPath === undefined) {
      return NodeOutputBuilder.of('valid');
    }

    const validator = await compileSchema(schemaPath);
    const valid     = validator(state.output);
    if (!valid) {
      const errors = (validator.errors ?? []).map((ajvError) => `${ajvError.instancePath} ${ajvError.message ?? ''}`.trim()).join('; ');
      const err = ExternalSchemaError.create(`Output failed schema validation: ${errors}`, {
        metadata: { task: 'validate:schema', schemaPath, errors: validator.errors },
      });
      state.collectError(toNodeError(err, 'validate:schema'));
      log.warn('validate:schema', `Schema violation: ${errors}`, { schemaPath });
      return NodeOutputBuilder.of('invalid');
    }

    return NodeOutputBuilder.of('valid');
  }
}

export const ValidateSchemaNode = new ValidateSchemaNodeImpl();
