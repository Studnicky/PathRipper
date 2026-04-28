import { FilterRegistry } from './FilterRegistry.js';
import type { FilterValueType } from './FilterRegistry.js';
import { TemplateParser } from './TemplateParser.js';
import type { TemplateInterface } from './TemplateParser.js';

export type MappingDeclarationType = Readonly<Record<string, string>>;
export type MappingResultType = Record<string, FilterValueType>;

interface CompiledMappingInterface {
  readonly entries: ReadonlyArray<readonly [string, TemplateInterface]>;
}

export class MappingEngine {
  readonly #compiled: CompiledMappingInterface;

  private constructor(compiled: CompiledMappingInterface) {
    this.#compiled = compiled;
  }

  public static compile(mapping: MappingDeclarationType): MappingEngine {
    const entries = Object.entries(mapping).map(
      ([key, template]): readonly [string, TemplateInterface] => [key, TemplateParser.parse(template)],
    );
    return new MappingEngine({ entries });
  }

  public project(raw: Readonly<Record<string, unknown>>): MappingResultType {
    const result: MappingResultType = {};
    for (const [key, tpl] of this.#compiled.entries) {
      let value: FilterValueType = MappingEngine.lookupField(raw, tpl.field);
      for (const step of tpl.filters) {
        value = FilterRegistry.apply(step.name, value, step.args);
      }
      result[key] = value;
    }
    return result;
  }

  private static lookupField(raw: Readonly<Record<string, unknown>>, field: string): FilterValueType {
    if (field === '_self') {
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
}
