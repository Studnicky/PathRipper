import type { FromSchema } from 'json-schema-to-ts';
import type { RunStateSchema } from '../schemas/internal/RunStateSchema.js';

/**
 * Validated run-state parameters for a single scrape run, derived from the JSON
 * Schema via `json-schema-to-ts`.
 *
 * @remarks
 * The shape is authoritative — editing the schema constant in `RunStateSchema`
 * changes this type automatically. A `RunState` is the flattened, single-run
 * projection of a resolved ripperoni config target: the `output` block plus all
 * per-target knobs (throttling, retry, concurrency, headers, mapping, cache,
 * crawler, MediaWiki params), minus the `pipeline` field. It seeds dispatch
 * state in the new architecture.
 *
 * @example
 * ```ts
 * const state: RunStateType = JSON.parse(await fs.readFile('.state.json', 'utf8'));
 * const err = RunStateSchema.validate(state);
 * if (err) throw new Error(err);
 * console.log(state.output.basePath);
 * ```
 *
 * @category Configuration
 * @since 2.7.0
 * @see {@link RunStateSchema}
 * @group Types
 */
export type RunStateType = FromSchema<typeof RunStateSchema.SCHEMA>;

/**
 * The `output` block of a run state — where and how results are written.
 *
 * @category Configuration
 * @since 2.7.0
 * @group Types
 */
export type RunOutputType = RunStateType['output'];

/**
 * The inline crawler block of a run state — optional link-discovery config.
 *
 * @category Configuration
 * @since 2.7.0
 * @group Types
 */
export type RunCrawlerType = NonNullable<RunStateType['crawler']>;
