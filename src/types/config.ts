import type { FromSchema } from 'json-schema-to-ts';

import type { RIPPER_CONFIG_SCHEMA } from '../schemas/internal/RipperConfigSchema.js';

export type RipperConfigInterface = FromSchema<typeof RIPPER_CONFIG_SCHEMA>;

export type HttpTargetConfigInterface     = NonNullable<RipperConfigInterface['targets']>[string];
export type MediaWikiTargetConfigInterface = NonNullable<RipperConfigInterface['mediawiki']>[string];
export type CrawlerConfigInterface         = NonNullable<RipperConfigInterface['crawlers']>[string];
export type OutputConfigInterface          = RipperConfigInterface['output'];
