import AjvModule, { type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';

import type { AjvCtorType, AddFormatsFnInterface } from '../../types/AjvInterop.js';
import type { ValidateResult } from '../../types/Results.js';

// AJV 8.x ships dual CJS/ESM; under NodeNext the runtime default lives on `.default`.
const Ajv        = (AjvModule        as unknown as { default?: AjvCtorType }).default        ?? (AjvModule        as unknown as AjvCtorType);
const addFormats = (addFormatsModule as unknown as { default?: AddFormatsFnInterface }).default ?? (addFormatsModule as unknown as AddFormatsFnInterface);

const JSON_SCHEMA_DRAFT_07_URI = 'http://json-schema.org/draft-07/schema#';

const SCHEMA = {
  $schema: JSON_SCHEMA_DRAFT_07_URI,
  $id: 'https://ripperoni.dev/schemas/internal/run-state.schema.json',
  title: 'RunState',
  description: 'Parameters for a single scrape run. Flattened from a resolved ripperoni config target — one run, one set of params, no pipeline field.',
  type: 'object',
  additionalProperties: false,
  required: ['output'],
  properties: {
    output: {
      title: 'Output Settings',
      description: 'Controls where and how ripperoni writes its results. All per-target pipelines ultimately write into the tree rooted at `basePath`.',
      type: 'object',
      additionalProperties: false,
      required: ['basePath'],
      properties: {
        basePath: {
          title: 'Output Base Path',
          description: 'Filesystem path (absolute or relative to cwd) under which all output files and subdirectories are written.',
          type: 'string',
          minLength: 1,
          examples: ['./output'],
        },
        format: {
          title: 'Output Format',
          description: 'Serialization format applied when writing result files. Defaults to `json` when omitted.',
          type: 'string',
          enum: ['json', 'html', 'text'],
          examples: ['json'],
        },
        pretty: {
          title: 'Pretty Print',
          description: 'When true, JSON output is formatted with two-space indentation for human readability rather than minified.',
          type: 'boolean',
          examples: [true],
        },
        rawSubdir: {
          title: 'Raw Subdirectory',
          description: 'Subdirectory name under `basePath` where unprocessed HTTP response bodies are stored when `includeRawContent` is enabled on a target.',
          type: 'string',
          minLength: 1,
          examples: ['_raw'],
        },
        rawExt: {
          title: 'Raw File Extension',
          description: 'File extension (without dot) used when persisting raw response bodies to disk.',
          type: 'string',
          minLength: 1,
          examples: ['html'],
        },
        splitByTaskName: {
          title: 'Split By Task Name',
          description: 'When true, output files are partitioned into per-task subdirectories beneath `basePath`, making it easier to isolate results from each pipeline step.',
          type: 'boolean',
          examples: [false],
        },
      },
    },
    baseUrl: {
      title: 'Base URL',
      description: 'Root URL of the scrape target. All relative page paths within the pipeline are resolved against this origin.',
      type: 'string',
      format: 'uri',
      minLength: 1,
      examples: ['https://example.com'],
    },
    rateLimitMs: {
      title: 'Rate Limit (ms)',
      description: 'Minimum delay in milliseconds between consecutive HTTP requests to this target, applied before the optional jitter offset.',
      type: 'integer',
      minimum: 0,
      examples: [500],
    },
    jitterMs: {
      title: 'Jitter (ms)',
      description: 'Maximum random additional delay in milliseconds added on top of `rateLimitMs` to prevent thundering-herd patterns when multiple workers hit the same host.',
      type: 'integer',
      minimum: 0,
      examples: [100],
    },
    maxRetries: {
      title: 'Max Retries',
      description: 'Number of times a failed HTTP request is retried before the error is surfaced to the pipeline. Applies exponential back-off between attempts.',
      type: 'integer',
      minimum: 0,
      maximum: 10,
      examples: [3],
    },
    retryBaseDelayMs: {
      title: 'Retry Base Delay (ms)',
      description: 'Starting delay in milliseconds for the exponential back-off sequence. Each successive retry multiplies this value.',
      type: 'integer',
      minimum: 100,
      examples: [500],
    },
    retryMaxDelayMs: {
      title: 'Retry Max Delay (ms)',
      description: 'Upper bound in milliseconds for the exponential back-off delay. Retries never wait longer than this value regardless of the exponent.',
      type: 'integer',
      minimum: 1000,
      examples: [30000],
    },
    concurrency: {
      title: 'Concurrency',
      description: 'Maximum number of in-flight HTTP requests allowed simultaneously for this target.',
      type: 'integer',
      minimum: 1,
      maximum: 32,
      examples: [4],
    },
    maxPages: {
      title: 'Max Pages',
      description: 'Hard limit on the total number of pages fetched for this target in a single run. Zero means unlimited.',
      type: 'integer',
      minimum: 0,
      examples: [500],
    },
    headers: {
      title: 'Request Headers',
      description: 'Additional HTTP request headers merged into every outbound request for this target. Common uses include custom `User-Agent` strings or API authentication tokens.',
      type: 'object',
      additionalProperties: { type: 'string' },
      examples: [{ 'User-Agent': 'MyBot/1.0' }],
    },
    outputSchema: {
      title: 'Output Schema Path',
      description: 'Filesystem path or module specifier for a JSON Schema file that each pipeline output record is validated against before being written.',
      type: 'string',
      minLength: 1,
      examples: ['./plugins/my-target/output.schema.json'],
    },
    onSchemaError: {
      title: 'On Schema Error',
      description: 'Governs what happens when a pipeline output record fails validation against `outputSchema`. `halt` aborts the run, `skip` silently drops the record, and `warn` logs the error and continues.',
      type: 'string',
      enum: ['halt', 'skip', 'warn'],
      examples: ['warn'],
    },
    includeRawContent: {
      title: 'Include Raw Content',
      description: 'When true, the raw HTTP response body is written alongside the processed output, enabling post-hoc re-parsing without re-fetching.',
      type: 'boolean',
      examples: [true],
    },
    mapping: {
      title: 'Field Mapping',
      description: 'Key-value pairs that map canonical output field names to source-specific selectors or alternative names, allowing a shared parse task to be reused across structurally similar targets.',
      type: 'object',
      additionalProperties: { type: 'string', minLength: 1 },
      examples: [{ title: 'h1.page-title', body: 'div.content' }],
    },
    cache: {
      title: 'Cache Settings',
      description: 'Configures the on-disk response cache for this run. When enabled, HTTP responses are stored locally so subsequent runs can skip network requests for already-fetched pages.',
      type: 'object',
      additionalProperties: false,
      required: ['dir', 'mode'],
      examples: [{ dir: './output/.cache/my-target', mode: 'read-write', ttlMs: 86400000 }],
      properties: {
        dir: {
          title: 'Cache Directory',
          description: 'Directory where cached HTTP responses are stored. Ripperoni creates this path if it does not exist.',
          type: 'string',
          minLength: 1,
          examples: ['./output/.cache/my-target'],
        },
        mode: {
          title: 'Cache Mode',
          description: 'Controls how the cache interacts with the network. `read-write` serves cached responses and stores new ones. `read-only` serves cached responses but never writes. `write-only` always fetches from the network and overwrites the cache. `off` disables the cache entirely.',
          type: 'string',
          enum: ['read-write', 'read-only', 'write-only', 'off'],
          examples: ['read-write'],
        },
        ttlMs: {
          title: 'Cache TTL (ms)',
          description: 'Time-to-live in milliseconds for cached entries. Entries older than this threshold are treated as stale and re-fetched. Zero means entries never expire.',
          type: 'integer',
          minimum: 0,
          examples: [86400000],
        },
      },
    },
    crawler: {
      title: 'Inline Crawler',
      description: 'Optional crawler configuration for this run. When present, ripperoni discovers pages to scrape by crawling from `startUrls` before invoking the pipeline.',
      type: 'object',
      additionalProperties: false,
      required: ['startUrls', 'domain', 'target', 'delimiter'],
      examples: [
        {
          startUrls: ['https://example.com/index'],
          domain: 'example\\.com',
          target: '\\?id=',
          delimiter: 'category',
          rateLimitMs: 100,
          jitterMs: 25,
          maxPages: 500,
        },
      ],
      properties: {
        startUrls: {
          title: 'Start URLs',
          description: 'One or more absolute URLs from which the crawler begins its link-discovery traversal.',
          type: 'array',
          minItems: 1,
          items: { type: 'string', format: 'uri', minLength: 1 },
          examples: [['https://example.com/index']],
        },
        domain: {
          title: 'Domain Pattern',
          description: 'Regular expression string used to restrict link following to a specific domain or path prefix, preventing the crawler from wandering to external sites.',
          type: 'string',
          minLength: 1,
          examples: ['example\\.com'],
        },
        target: {
          title: 'Target URL Pattern',
          description: 'Regular expression string that identifies which discovered URLs are passed to the scrape pipeline as pages to process.',
          type: 'string',
          minLength: 1,
          examples: ['\\?id='],
        },
        delimiter: {
          title: 'Delimiter Pattern',
          description: 'Regular expression string or literal value used to segment or categorize discovered URLs, for example by a query-string parameter that names the content category.',
          type: 'string',
          minLength: 1,
          examples: ['category'],
        },
        rateLimitMs: {
          title: 'Crawler Rate Limit (ms)',
          description: 'Minimum delay in milliseconds between consecutive crawler requests, applied independently of the parent target rate limit.',
          type: 'integer',
          minimum: 0,
          examples: [100],
        },
        jitterMs: {
          title: 'Crawler Jitter (ms)',
          description: 'Maximum random additional delay in milliseconds added on top of the crawler `rateLimitMs`.',
          type: 'integer',
          minimum: 0,
          examples: [25],
        },
        maxPages: {
          title: 'Crawler Max Pages',
          description: 'Maximum number of pages the crawler will discover and enqueue before stopping. Prevents runaway traversals on very large sites.',
          type: 'integer',
          minimum: 1,
          examples: [500],
        },
        concurrency: {
          title: 'Crawler Concurrency',
          description: 'Maximum number of pages fetched concurrently within a single BFS depth level. The rate limiter still applies between individual requests. Defaults to 1 (sequential) when absent.',
          type: 'integer',
          minimum: 1,
          maximum: 32,
          examples: [4],
        },
      },
    },
    useJsdom: {
      title: 'JSDOM Mode',
      description: 'When true, fetched HTML is processed through JSDOM before parsing. Enables execution of synchronous scripts and DOM manipulation. Defaults to false.',
      type: 'boolean',
      examples: [true],
    },
    jsdomLoadTimeoutMs: {
      title: 'JSDOM Load Timeout (ms)',
      description: 'Ceiling in milliseconds for the JSDOM `load` event wait when `useJsdom` is true. The `load` event resolves the race immediately when it fires — a page that loads in 3 s proceeds at 3 s regardless of this value. This ceiling is only raised when scripts hang and never fire `load`. Defaults to `max(10000, retryMaxDelayMs ?? 30000)` so the fallback scales with the site\'s retry tolerance.',
      type: 'integer',
      minimum: 1000,
      examples: [30000],
    },
    parallelWorkers: {
      title: 'Parallel Workers',
      description: 'When true, scatter nodes whose DAG placement declares `container: "worker"` are executed in a `WorkerThreadContainer` pool instead of in-process. Defaults to false when absent. Requires the built `dist-workers/` registry module.',
      type: 'boolean',
      examples: [true],
    },
    urls: {
      title: 'Seed URLs',
      description: 'Explicit list of page URLs to scrape. When present, the run seeds `ScrapeState.urls` directly from this list — the orchestration DAG scatters over them without a crawl phase. Mutually convenient with an embedded `crawler` block: supply `urls` for a bounded, deterministic page set; supply `crawler` for link discovery.',
      type: 'array',
      items: { type: 'string', minLength: 1 },
      examples: [['https://example.com/Page.aspx?ID=1']],
    },
    apiUrl: {
      title: 'API URL',
      description: 'Full URL of the MediaWiki Action API endpoint, typically ending in `/w/api.php`.',
      type: 'string',
      format: 'uri',
      minLength: 1,
      examples: ['https://wiki.example/w/api.php'],
    },
    batchSize: {
      title: 'Batch Size',
      description: 'Number of pages requested per API call. Larger values reduce round-trips; the MediaWiki API caps this at 50 for unprivileged users.',
      type: 'integer',
      minimum: 1,
      maximum: 50,
      examples: [50],
    },
    categories: {
      title: 'Wiki Categories',
      description: 'MediaWiki category names whose member pages are fetched. When omitted, the target fetches pages from `allpages` or a custom query.',
      type: 'array',
      items: { type: 'string', minLength: 1 },
      examples: [['Spells', 'Feats']],
    },
    reservoir: {
      title: 'Scatter Reservoir',
      description: 'Reservoir scatter configuration for very large URL lists. When set, documents the intended `reservoir` block in the orchestration DAG scatter node — `capacity` items are processed concurrently rather than all at once, keeping memory bounded. Set the matching `reservoir.keyField` and `reservoir.capacity` on the `ScatterNode` in the `.dag.jsonld` to activate engine-level reservoir scatter.',
      type: 'object',
      additionalProperties: false,
      required: ['keyField', 'capacity'],
      examples: [{ keyField: 'currentItem', capacity: 50, idleMs: 30000 }],
      properties: {
        keyField: {
          title: 'Key Field',
          description: 'State field name used as the unique key for each reservoir slot. Must match the `itemKey` of the scatter node (typically `currentItem`).',
          type: 'string',
          minLength: 1,
          examples: ['currentItem'],
        },
        capacity: {
          title: 'Reservoir Capacity',
          description: 'Maximum number of scatter items processed concurrently. The engine pulls items from the source array in batches of this size, releasing a slot only when an item completes.',
          type: 'integer',
          minimum: 1,
          maximum: 1000,
          examples: [50],
        },
        idleMs: {
          title: 'Idle Timeout (ms)',
          description: 'Milliseconds after which an idle reservoir (no active items, source exhausted) is considered complete. Defaults to 30000 when absent.',
          type: 'integer',
          minimum: 1000,
          examples: [30000],
        },
      },
    },
  },
} as const;

const ajv = new Ajv({ allErrors: true, strict: true, useDefaults: false });
addFormats(ajv);

/**
 * Provides AJV-based validation for the run-state parameters file (`.state.json`).
 *
 * @remarks
 * All methods and properties are static. The `SCHEMA` property exposes the raw
 * JSON Schema Draft-07 object for use in type derivation.
 *
 * A `RunState` is a flattened, single-run view of a resolved ripperoni config
 * target — the `output` block plus all per-target knobs, minus the `pipeline`
 * field. It seeds dispatch state in the new architecture.
 *
 * @example
 * ```ts
 * const errors = RunStateSchema.validate(rawJson);
 * if (errors !== null) throw new Error(errors);
 * ```
 * @category Schema
 * @since 2.7.0
 * @group Schema
 * @see RunStateType
 */
export class RunStateSchema {
  private constructor() { /* static-only */ }

  /** JSON Schema Draft-07 definition for a single scrape run's parameters. */
  public static readonly SCHEMA: typeof SCHEMA = SCHEMA;

  private static readonly _validate: ValidateFunction<object> =
    ajv.compile(SCHEMA);

  /**
   * Validates data against the RunState schema.
   *
   * @param data - Unknown value to validate.
   * @returns `null` when `data` is valid; a human-readable error string otherwise.
   */
  public static validate(data: unknown): ValidateResult {
    if (RunStateSchema._validate(data as object)) return null;
    return ajv.errorsText(RunStateSchema._validate.errors, { separator: '\n  ' });
  }
}
