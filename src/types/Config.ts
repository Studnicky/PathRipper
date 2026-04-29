import type { FromSchema } from 'json-schema-to-ts';
import type { RipperConfigSchema } from '../schemas/internal/RipperConfigSchema.js';

/**
 * Validated ripperoni configuration, derived from the JSON Schema via `json-schema-to-ts`.
 *
 * @remarks
 * The shape is authoritative — editing the schema constant in `RipperConfigSchema` changes
 * this type automatically. Load and validate an instance with {@link RipperConfig.load}.
 *
 * @example
 * ```ts
 * const config: RipperConfigInterface = await RipperConfig.load('./ripperoni.config.json');
 * console.log(config.output.basePath);
 * ```
 *
 * @category Configuration
 * @since 2.0.0
 * @see {@link RipperConfig}
 * @group Types
 */
export type RipperConfigInterface = FromSchema<typeof RipperConfigSchema.SCHEMA>;
