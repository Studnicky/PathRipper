import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  validateRipperConfig,
  formatRipperConfigErrors,
} from '../schemas/internal/RipperConfigSchema.js';
import type { RipperConfigInterface } from '../schemas/internal/RipperConfigSchema.js';
import { RipperConfigError } from '../errors/RipperConfigError.js';

export type {
  RipperConfigInterface,
} from '../schemas/internal/RipperConfigSchema.js';

export type HttpTargetConfigInterface     = NonNullable<RipperConfigInterface['targets']>[string];
export type MediaWikiTargetConfigInterface = NonNullable<RipperConfigInterface['mediawiki']>[string];
export type CrawlerConfigInterface         = NonNullable<RipperConfigInterface['crawlers']>[string];
export type OutputConfigInterface          = RipperConfigInterface['output'];

export class RipperConfig {
  static async load(configPath: string): Promise<RipperConfigInterface> {
    const abs  = resolve(configPath);
    const text = await readFile(abs, 'utf-8');
    const raw  = JSON.parse(text) as unknown;

    if (!validateRipperConfig(raw)) {
      throw new RipperConfigError(
        `Invalid config at ${abs}:\n  ${formatRipperConfigErrors()}`,
        { metadata: { configPath: abs } },
      );
    }

    return raw;
  }

  static defaults(): RipperConfigInterface {
    return {
      output: { basePath: './output', format: 'json', pretty: true },
    };
  }
}
