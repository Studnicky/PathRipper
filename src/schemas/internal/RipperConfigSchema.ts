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
  $id: 'https://ripperoni.dev/schemas/internal/ripper-config.schema.json',
  title: 'RipperConfig',
  description: 'Root configuration document for a ripperoni scrape run. Every target, crawler, and output option is declared here and validated before any network activity begins.',
  type: 'object',
  additionalProperties: false,
  required: ['output'],
  examples: [
    {
      output: { basePath: './output', format: 'json', pretty: true },
      targets: {
        'my-html-target': {
          baseUrl: 'https://example.com',
          rateLimitMs: 500,
          pipeline: ['html:fetch', 'my-html-target:parse', 'json:write'],
          cache: { dir: './output/.cache/my-html-target', mode: 'read-write' },
        },
      },
    },
  ],
  properties: {
    output: {
      title: 'Output Settings',
      description: 'Controls where and how ripperoni writes its results. All per-target pipelines ultimately write into the tree rooted at `basePath`.',
      type: 'object',
      additionalProperties: false,
      required: ['basePath'],
      examples: [
        { basePath: './output', format: 'json', pretty: true },
      ],
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
    targets: {
      title: 'HTML Targets',
      description: 'Named HTTP scrape targets. Each key is a user-defined identifier that pipeline tasks use to look up configuration at runtime.',
      type: 'object',
      additionalProperties: {
        title: 'HTML Target',
        description: 'Configuration for a single HTML scrape target, including its base URL, throttling policy, retry behaviour, and the ordered list of pipeline tasks to execute.',
        type: 'object',
        additionalProperties: false,
        required: ['baseUrl', 'pipeline'],
        examples: [
          {
            baseUrl: 'https://example.com',
            rateLimitMs: 500,
            jitterMs: 100,
            maxRetries: 3,
            retryBaseDelayMs: 500,
            retryMaxDelayMs: 30000,
            pipeline: ['html:fetch', 'my-target:parse', 'json:write'],
            cache: { dir: './output/.cache/my-target', mode: 'read-write' },
          },
        ],
        properties: {
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
          pipeline: {
            title: 'Pipeline Tasks',
            description: 'Ordered sequence of task identifiers executed for each page scraped from this target. Tasks are resolved from the registry and run left-to-right.',
            type: 'array',
            minItems: 1,
            items: { type: 'string', minLength: 1 },
            examples: [['html:fetch', 'my-target:parse', 'json:write']],
          },
          cache: {
            title: 'Cache Settings',
            description: 'Configures the on-disk response cache for this target. When enabled, HTTP responses are stored locally so subsequent runs can skip network requests for already-fetched pages.',
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
            description: 'Optional crawler configuration embedded directly in the target. When present, ripperoni discovers pages to scrape by crawling from `startUrls` before invoking the pipeline.',
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
            },
          },
        },
      },
    },
    mediawiki: {
      title: 'MediaWiki Targets',
      description: 'Named MediaWiki API targets. Each key is a user-defined identifier. Ripperoni fetches pages via the MediaWiki Action API and passes them through the declared pipeline.',
      type: 'object',
      additionalProperties: {
        title: 'MediaWiki Target',
        description: 'Configuration for a single MediaWiki scrape target, including its API endpoint, throttling policy, batch settings, and the ordered list of pipeline tasks to execute.',
        type: 'object',
        additionalProperties: false,
        required: ['apiUrl', 'pipeline'],
        examples: [
          {
            apiUrl: 'https://wiki.example/w/api.php',
            rateLimitMs: 2000,
            jitterMs: 500,
            batchSize: 50,
            maxPages: 500,
            maxRetries: 3,
            retryBaseDelayMs: 500,
            retryMaxDelayMs: 30000,
            categories: ['Example Category'],
            pipeline: ['wiki:fetch', 'my-wiki:parse', 'json:write'],
            cache: { dir: './output/.cache/my-wiki', mode: 'read-write' },
          },
        ],
        properties: {
          apiUrl: {
            title: 'API URL',
            description: 'Full URL of the MediaWiki Action API endpoint, typically ending in `/w/api.php`.',
            type: 'string',
            format: 'uri',
            minLength: 1,
            examples: ['https://wiki.example/w/api.php'],
          },
          rateLimitMs: {
            title: 'Rate Limit (ms)',
            description: 'Minimum delay in milliseconds between consecutive API requests to this MediaWiki instance.',
            type: 'integer',
            minimum: 0,
            examples: [2000],
          },
          jitterMs: {
            title: 'Jitter (ms)',
            description: 'Maximum random additional delay in milliseconds added on top of `rateLimitMs` to spread API request load.',
            type: 'integer',
            minimum: 0,
            examples: [500],
          },
          batchSize: {
            title: 'Batch Size',
            description: 'Number of pages requested per API call. Larger values reduce round-trips; the MediaWiki API caps this at 50 for unprivileged users.',
            type: 'integer',
            minimum: 1,
            maximum: 50,
            examples: [50],
          },
          maxPages: {
            title: 'Max Pages',
            description: 'Hard limit on the total number of wiki pages fetched for this target in a single run. Zero means unlimited.',
            type: 'integer',
            minimum: 0,
            examples: [500],
          },
          maxRetries: {
            title: 'Max Retries',
            description: 'Number of times a failed API request is retried before surfacing the error. Applies exponential back-off between attempts.',
            type: 'integer',
            minimum: 0,
            maximum: 10,
            examples: [3],
          },
          retryBaseDelayMs: {
            title: 'Retry Base Delay (ms)',
            description: 'Starting delay in milliseconds for exponential back-off on retried MediaWiki API requests.',
            type: 'integer',
            minimum: 100,
            examples: [500],
          },
          retryMaxDelayMs: {
            title: 'Retry Max Delay (ms)',
            description: 'Upper bound in milliseconds for the exponential back-off delay on MediaWiki API retries.',
            type: 'integer',
            minimum: 1000,
            examples: [30000],
          },
          concurrency: {
            title: 'Concurrency',
            description: 'Maximum number of in-flight MediaWiki API requests allowed at the same time for this target.',
            type: 'integer',
            minimum: 1,
            maximum: 32,
            examples: [4],
          },
          outputSchema: {
            title: 'Output Schema Path',
            description: 'Filesystem path or module specifier for a JSON Schema file that each pipeline output record is validated against before being written.',
            type: 'string',
            minLength: 1,
            examples: ['./plugins/my-wiki/output.schema.json'],
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
            description: 'When true, the raw wikitext response is written alongside the processed output, enabling post-hoc re-parsing without re-fetching.',
            type: 'boolean',
            examples: [true],
          },
          mapping: {
            title: 'Field Mapping',
            description: 'Key-value pairs that map canonical output field names to wikitext template parameters or infobox keys, allowing a shared parse task to work across structurally similar wikis.',
            type: 'object',
            additionalProperties: { type: 'string', minLength: 1 },
            examples: [{ title: 'title', body: 'description' }],
          },
          categories: {
            title: 'Wiki Categories',
            description: 'MediaWiki category names whose member pages are fetched. When omitted, the target fetches pages from `allpages` or a custom query.',
            type: 'array',
            items: { type: 'string', minLength: 1 },
            examples: [['Spells', 'Feats']],
          },
          pipeline: {
            title: 'Pipeline Tasks',
            description: 'Ordered sequence of task identifiers executed for each wiki page fetched from this target.',
            type: 'array',
            minItems: 1,
            items: { type: 'string', minLength: 1 },
            examples: [['wiki:fetch', 'my-wiki:parse', 'json:write']],
          },
          cache: {
            title: 'Cache Settings',
            description: 'Configures the on-disk response cache for this MediaWiki target. Cached API responses allow re-parsing without hitting the wiki API again.',
            type: 'object',
            additionalProperties: false,
            required: ['dir', 'mode'],
            examples: [{ dir: './output/.cache/my-wiki', mode: 'read-write', ttlMs: 86400000 }],
            properties: {
              dir: {
                title: 'Cache Directory',
                description: 'Directory where cached MediaWiki API responses are stored.',
                type: 'string',
                minLength: 1,
                examples: ['./output/.cache/my-wiki'],
              },
              mode: {
                title: 'Cache Mode',
                description: 'Controls how the cache interacts with the MediaWiki API. `read-write` serves cached responses and stores new ones. `read-only` serves cached responses but never writes. `write-only` always fetches from the API and overwrites the cache. `off` disables the cache entirely.',
                type: 'string',
                enum: ['read-write', 'read-only', 'write-only', 'off'],
                examples: ['read-write'],
              },
              ttlMs: {
                title: 'Cache TTL (ms)',
                description: 'Time-to-live in milliseconds for cached MediaWiki API responses. Zero means entries never expire.',
                type: 'integer',
                minimum: 0,
                examples: [86400000],
              },
            },
          },
        },
      },
    },
    crawlers: {
      title: 'Standalone Crawlers',
      description: 'Named standalone link-discovery crawlers. These run independently of any scrape target and populate a URL list that can be referenced by downstream targets.',
      type: 'object',
      additionalProperties: {
        title: 'Crawler',
        description: 'Configuration for a standalone crawler that traverses a website starting from `startUrls`, collects matching page URLs, and hands them off to a named target.',
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
            maxPages: 1000,
          },
        ],
        properties: {
          startUrls: {
            title: 'Start URLs',
            description: 'One or more absolute URLs from which this crawler begins its link-discovery traversal.',
            type: 'array',
            minItems: 1,
            items: { type: 'string', format: 'uri', minLength: 1 },
            examples: [['https://example.com/index']],
          },
          domain: {
            title: 'Domain Pattern',
            description: 'Regular expression string used to restrict link following to a specific domain or path prefix.',
            type: 'string',
            minLength: 1,
            examples: ['example\\.com'],
          },
          target: {
            title: 'Target URL Pattern',
            description: 'Regular expression string that identifies which discovered URLs represent pages to be scraped.',
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
            title: 'Rate Limit (ms)',
            description: 'Minimum delay in milliseconds between consecutive crawler requests.',
            type: 'integer',
            minimum: 0,
            examples: [100],
          },
          jitterMs: {
            title: 'Jitter (ms)',
            description: 'Maximum random additional delay in milliseconds added on top of `rateLimitMs` during crawling.',
            type: 'integer',
            minimum: 0,
            examples: [25],
          },
          maxPages: {
            title: 'Max Pages',
            description: 'Maximum number of pages the crawler will discover and enqueue before stopping.',
            type: 'integer',
            minimum: 1,
            examples: [1000],
          },
        },
      },
    },
  },
} as const;

const ajv = new Ajv({ allErrors: true, strict: true, useDefaults: false });
addFormats(ajv);

/**
 * Provides AJV-based validation for the ripperoni configuration file.
 *
 * @remarks
 * All methods and properties are static. The `SCHEMA` property exposes the raw
 * JSON Schema Draft-07 object for use in type derivation.
 *
 * @example
 * ```ts
 * const errors = RipperConfigSchema.validate(rawJson);
 * if (errors !== null) throw new Error(errors);
 * ```
 * @category Schema
 * @since 2.0.0
 * @group Schema
 * @see RipperConfigType
 */
export class RipperConfigSchema {
  private constructor() { /* static-only */ }

  /** JSON Schema Draft-07 definition for the ripperoni configuration file. */
  public static readonly SCHEMA: typeof SCHEMA = SCHEMA;

  private static readonly _validate: ValidateFunction<object> =
    ajv.compile(SCHEMA);

  /**
   * Validates data against the RipperConfig schema.
   *
   * @param data - Unknown value to validate.
   * @returns `null` when `data` is valid; a human-readable error string otherwise.
   */
  public static validate(data: unknown): ValidateResult {
    if (RipperConfigSchema._validate(data as object)) return null;
    return ajv.errorsText(RipperConfigSchema._validate.errors, { separator: '\n  ' });
  }
}
