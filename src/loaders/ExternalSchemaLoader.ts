import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';

import AjvModule, { type Ajv as AjvType, type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';

import { ExternalSchemaError } from '../errors/ExternalSchemaError.js';

type AjvCtorType = new (opts?: ConstructorParameters<typeof AjvType>[0]) => AjvType;
type AddFormatsFnType = (ajv: AjvType) => AjvType;

const Ajv        = (AjvModule        as unknown as { default?: AjvCtorType }).default        ?? (AjvModule        as unknown as AjvCtorType);
const addFormats = (addFormatsModule as unknown as { default?: AddFormatsFnType }).default ?? (addFormatsModule as unknown as AddFormatsFnType);

export interface CompiledExternalSchemaInterface {
  readonly key: string;
  readonly validate: ValidateFunction<unknown>;
  readonly format: (errors: unknown) => string;
}

export class ExternalSchemaLoader {
  static readonly #cache = new Map<string, CompiledExternalSchemaInterface>();

  private constructor() { /* static-only */ }

  static async load(reference: string, baseDir = process.cwd()): Promise<CompiledExternalSchemaInterface> {
    const key = ExternalSchemaLoader.#canonicalize(reference, baseDir);
    const cached = ExternalSchemaLoader.#cache.get(key);
    if (cached !== undefined) return cached;

    const text = await ExternalSchemaLoader.#fetchText(key);
    const schema = JSON.parse(text) as unknown;

    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema as object) as ValidateFunction<unknown>;

    const compiled: CompiledExternalSchemaInterface = {
      key,
      validate,
      format: () => ajv.errorsText(validate.errors, { separator: '\n  ' }),
    };

    ExternalSchemaLoader.#cache.set(key, compiled);
    return compiled;
  }

  static reset(): void {
    ExternalSchemaLoader.#cache.clear();
  }

  static #canonicalize(reference: string, baseDir: string): string {
    if (reference.startsWith('http://') || reference.startsWith('https://')) return reference;
    if (reference.startsWith('file:')) return reference;
    return `file://${resolvePath(baseDir, reference)}`;
  }

  static async #fetchText(key: string): Promise<string> {
    if (key.startsWith('file://')) {
      return readFile(key.slice('file://'.length), 'utf-8');
    }
    const res = await fetch(key);
    if (!res.ok) {
      throw new ExternalSchemaError(`Failed to fetch external schema (${res.status.toString()}): ${key}`, { metadata: { key, status: res.status } });
    }
    return res.text();
  }
}
