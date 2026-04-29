import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { RipperConfigSchema } from '../schemas/internal/RipperConfigSchema.js';
import type { RipperConfigInterface } from '../types/Config.js';
import type { ConfigLoadResult } from '../types/Results.js';
import { RipperConfigError } from '../errors/RipperConfigError.js';

/** Loads and validates ripperoni configuration files. */
export class RipperConfig {
  /**
   * Reads and AJV-validates a JSON config file.
   *
   * @param configPath - Path to the config JSON file (resolved to absolute).
   * @returns Validated `RipperConfigInterface` object.
   * @throws {RipperConfigError} When the file is missing, unparseable, or fails schema validation.
   */
  static async load(configPath: string): ConfigLoadResult {
    const abs  = resolve(configPath);
    const text = await readFile(abs, 'utf-8');
    const raw  = JSON.parse(text) as unknown;

    const errors = RipperConfigSchema.validate(raw);
    if (errors !== null) {
      throw RipperConfigError.create(
        `Invalid config at ${abs}:\n  ${errors}`,
        { metadata: { configPath: abs } },
      );
    }

    return raw as RipperConfigInterface;
  }

  /**
   * Returns a minimal valid config with sensible output defaults.
   *
   * @returns A `RipperConfigInterface` with `output.basePath` set to `./output`.
   */
  static defaults(): RipperConfigInterface {
    return {
      output: { basePath: './output', format: 'json', pretty: true },
    };
  }
}
