import type { FromSchema } from 'json-schema-to-ts';
import type { RipperConfigSchema } from '../schemas/internal/RipperConfigSchema.js';

/** Validated ripperoni configuration derived from the JSON schema. */
export type RipperConfigInterface = FromSchema<typeof RipperConfigSchema.SCHEMA>;
