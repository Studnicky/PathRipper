import { FilterRegistry } from './FilterRegistry.js';
import type { FilterValueType } from './FilterRegistry.js';
import { TemplateParser } from './TemplateParser.js';
import type { TemplateInterface } from './TemplateParser.js';

export type MappingDeclarationType = Readonly<Record<string, string>>;
export type MappingResultType = Record<string, FilterValueType>;

interface CompiledMapping {
  readonly entries: ReadonlyArray<readonly [string, TemplateInterface]>;
}

function lookupField(raw: Readonly<Record<string, unknown>>, field: string): FilterValueType {
  if (field === '_self') {
    // Allow piping the entire raw record as a string-coerced value.
    return JSON.stringify(raw);
  }
  const value = raw[field];
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((v) => {
      if (v === null || v === undefined) return null;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
      return JSON.stringify(v);
    });
  }
  return JSON.stringify(value);
}

export class MappingEngine {
  readonly #compiled: CompiledMapping;

  private constructor(compiled: CompiledMapping) {
    this.#compiled = compiled;
  }

  static compile(mapping: MappingDeclarationType): MappingEngine {
    const entries = Object.entries(mapping).map(
      ([key, template]): readonly [string, TemplateInterface] => [key, TemplateParser.parse(template)],
    );
    return new MappingEngine({ entries });
  }

  project(raw: Readonly<Record<string, unknown>>): MappingResultType {
    const result: MappingResultType = {};
    for (const [key, tpl] of this.#compiled.entries) {
      let value: FilterValueType = lookupField(raw, tpl.field);
      for (const step of tpl.filters) {
        value = FilterRegistry.apply(step.name, value, step.args);
      }
      result[key] = value;
    }
    return result;
  }
}
