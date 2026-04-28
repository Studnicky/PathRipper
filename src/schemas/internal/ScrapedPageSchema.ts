import AjvModule, { type Ajv as AjvType, type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';
import type { FromSchema } from 'json-schema-to-ts';

type AjvCtorType = new (opts?: ConstructorParameters<typeof AjvType>[0]) => AjvType;
type AddFormatsFnType = (ajv: AjvType) => AjvType;

const Ajv        = (AjvModule        as unknown as { default?: AjvCtorType }).default        ?? (AjvModule        as unknown as AjvCtorType);
const addFormats = (addFormatsModule as unknown as { default?: AddFormatsFnType }).default ?? (addFormatsModule as unknown as AddFormatsFnType);

export const SCRAPED_PAGE_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://ripperoni.dev/schemas/internal/scraped-page.schema.json',
  title: 'ScrapedPage',
  type: 'object',
  additionalProperties: false,
  required: ['targetId', 'kind', 'url', 'fetchedAt', 'raw'],
  properties: {
    targetId:  { type: 'string', minLength: 1 },
    kind:      { type: 'string', enum: ['html', 'mediawiki', 'crawler'] },
    url:       { type: 'string', minLength: 1 },
    fetchedAt: { type: 'string', format: 'date-time' },
    raw: {
      type: 'object',
      additionalProperties: true,
    },
  },
} as const;

export type ScrapedPageInterface = FromSchema<typeof SCRAPED_PAGE_SCHEMA>;

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);

export class ScrapedPageValidator {
  private constructor() { /* static-only */ }

  private static readonly _validate: ValidateFunction<ScrapedPageInterface> =
    ajv.compile<ScrapedPageInterface>(SCRAPED_PAGE_SCHEMA);

  public static validate(data: unknown): data is ScrapedPageInterface {
    return ScrapedPageValidator._validate(data);
  }

  public static formatErrors(): string {
    return ajv.errorsText(ScrapedPageValidator._validate.errors, { separator: '\n  ' });
  }
}

export const validateScrapedPage = ScrapedPageValidator.validate.bind(ScrapedPageValidator);
export function formatScrapedPageErrors(): string { return ScrapedPageValidator.formatErrors(); }
