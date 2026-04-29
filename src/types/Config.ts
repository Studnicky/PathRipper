import type { FromSchema } from 'json-schema-to-ts';
import type { RIPPER_CONFIG_SCHEMA } from '../schemas/internal/RipperConfigSchema.js';

/** Validated ripperoni configuration derived from the JSON schema. */
export type RipperConfigInterface = FromSchema<typeof RIPPER_CONFIG_SCHEMA>;
