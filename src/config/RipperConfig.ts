import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  validateRipperConfig,
  formatRipperConfigErrors,
} from '../schemas/internal/RipperConfigSchema.js';
import type { RipperConfigInterface } from '../types/config.js';
import { RipperConfigError } from '../errors/RipperConfigError.js';

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
