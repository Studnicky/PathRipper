import { createHash } from 'node:crypto';
import { load as cheerioLoad } from 'cheerio';

import { MappingError } from '../errors/MappingError.js';

export type FilterValueType = string | number | boolean | null | ReadonlyArray<string | number | boolean | null>;
export type FilterFnType = (value: FilterValueType, args: ReadonlyArray<string>) => FilterValueType;

export class FilterRegistry {
  static readonly #custom = new Map<string, FilterFnType>();

  static readonly #builtins: Readonly<Record<string, FilterFnType>> = Object.freeze({
    trim:     (v) => FilterRegistry.asString(v).trim(),
    lower:    (v) => FilterRegistry.asString(v).toLowerCase(),
    upper:    (v) => FilterRegistry.asString(v).toUpperCase(),
    text:     (v) => FilterRegistry.stripHtmlAndCollapse(FilterRegistry.asString(v)),
    truncate: (v, args) => {
      const n = parseInt(args[0] ?? '0', 10);
      const s = FilterRegistry.asString(v);
      if (!Number.isFinite(n) || n <= 0 || s.length <= n) return s;
      return s.slice(0, n) + '…';
    },
    hash:    (v) => createHash('sha256').update(FilterRegistry.asString(v)).digest('hex'),
    join:    (v, args) => {
      const sep = args[0] ?? ',';
      if (Array.isArray(v)) return v.map((x) => (x === null ? '' : String(x))).join(sep);
      return FilterRegistry.asString(v);
    },
    default: (v, args) => {
      const empty = v === null || v === undefined || (typeof v === 'string' && v.length === 0);
      return empty ? (args[0] ?? '') : v;
    },
  });

  private constructor() { /* static-only */ }

  public static register(name: string, fn: FilterFnType): void {
    if (name in FilterRegistry.#builtins) {
      throw new MappingError(`Cannot override built-in filter: ${name}`, { metadata: { filter: name } });
    }
    FilterRegistry.#custom.set(name, fn);
  }

  public static apply(name: string, value: FilterValueType, args: ReadonlyArray<string>): FilterValueType {
    const fn = FilterRegistry.#builtins[name] ?? FilterRegistry.#custom.get(name);
    if (fn === undefined) {
      throw new MappingError(`Unknown filter: ${name}`, { metadata: { filter: name } });
    }
    return fn(value, args);
  }

  public static has(name: string): boolean {
    return name in FilterRegistry.#builtins || FilterRegistry.#custom.has(name);
  }

  public static reset(): void {
    FilterRegistry.#custom.clear();
  }

  private static asString(v: FilterValueType): string {
    if (v === null) return '';
    if (Array.isArray(v)) return v.map((x) => (x === null ? '' : String(x))).join(' ');
    return String(v);
  }

  private static stripHtmlAndCollapse(s: string): string {
    const $ = cheerioLoad(`<div id="ripperoni-root">${s}</div>`);
    return $('#ripperoni-root').text().replace(/\s+/g, ' ').trim();
  }
}
