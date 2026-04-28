import { MappingError } from '../errors/MappingError.js';

export interface TemplateFilterStepInterface {
  readonly name: string;
  readonly args: ReadonlyArray<string>;
}

export interface TemplateInterface {
  readonly raw: string;
  readonly field: string;
  readonly filters: ReadonlyArray<TemplateFilterStepInterface>;
}

const TEMPLATE_RE = /^\s*\{\{\s*(.+?)\s*\}\}\s*$/;

export class TemplateParser {
  private constructor() { /* static-only */ }

  static parse(template: string): TemplateInterface {
    const match = TEMPLATE_RE.exec(template);
    if (match === null) {
      throw new MappingError(`Template must match {{ field | filter | filter:arg }}: "${template}"`, { metadata: { template } });
    }
    const inner = match[1] ?? '';
    const parts = inner.split('|').map((p) => p.trim()).filter((p) => p.length > 0);

    if (parts.length === 0) {
      throw new MappingError(`Template has no field: "${template}"`, { metadata: { template } });
    }

    const field   = parts[0]!;
    const filters = parts.slice(1).map((step): TemplateFilterStepInterface => {
      const colon = step.indexOf(':');
      if (colon === -1) return { name: step, args: [] };
      const name = step.slice(0, colon).trim();
      const args = step
        .slice(colon + 1)
        .split(',')
        .map((a) => a.trim())
        .filter((a) => a.length > 0);
      return { name, args };
    });

    return { raw: template, field, filters };
  }
}
