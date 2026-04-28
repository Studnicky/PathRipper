import { createHash } from 'node:crypto';
import { load as cheerioLoad } from 'cheerio';

export type FilterValueType = string | number | boolean | null | ReadonlyArray<string | number | boolean | null>;
export type FilterFnType = (value: FilterValueType, args: ReadonlyArray<string>) => FilterValueType;

function asString(v: FilterValueType): string {
  if (v === null) return '';
  if (Array.isArray(v)) return v.map((x) => (x === null ? '' : String(x))).join(' ');
  return String(v);
}

function stripHtmlAndCollapse(s: string): string {
  // Cheerio parses fragments safely; .text() returns concatenated text content.
  const $ = cheerioLoad(`<div id="ripperoni-root">${s}</div>`);
  const text = $('#ripperoni-root').text();
  return text.replace(/\s+/g, ' ').trim();
}

const BUILTINS: Readonly<Record<string, FilterFnType>> = Object.freeze({
  trim:     (v) => asString(v).trim(),
  lower:    (v) => asString(v).toLowerCase(),
  upper:    (v) => asString(v).toUpperCase(),
  text:     (v) => stripHtmlAndCollapse(asString(v)),
  truncate: (v, args) => {
    const n = parseInt(args[0] ?? '0', 10);
    const s = asString(v);
    if (!Number.isFinite(n) || n <= 0 || s.length <= n) return s;
    return s.slice(0, n) + '…';
  },
  hash:     (v) => createHash('sha256').update(asString(v)).digest('hex'),
  join:     (v, args) => {
    const sep = args[0] ?? ',';
    if (Array.isArray(v)) return v.map((x) => (x === null ? '' : String(x))).join(sep);
    return asString(v);
  },
  default:  (v, args) => {
    const empty = v === null || v === undefined || (typeof v === 'string' && v.length === 0);
    return empty ? (args[0] ?? '') : v;
  },
});

export class FilterRegistry {
  static readonly #custom = new Map<string, FilterFnType>();

  private constructor() { /* static-only */ }

  static register(name: string, fn: FilterFnType): void {
    if (name in BUILTINS) {
      throw new Error(`Cannot override built-in filter: ${name}`);
    }
    FilterRegistry.#custom.set(name, fn);
  }

  static apply(name: string, value: FilterValueType, args: ReadonlyArray<string>): FilterValueType {
    const fn = BUILTINS[name] ?? FilterRegistry.#custom.get(name);
    if (fn === undefined) {
      throw new Error(`Unknown filter: ${name}`);
    }
    return fn(value, args);
  }

  static has(name: string): boolean {
    return name in BUILTINS || FilterRegistry.#custom.has(name);
  }

  static reset(): void {
    FilterRegistry.#custom.clear();
  }
}
