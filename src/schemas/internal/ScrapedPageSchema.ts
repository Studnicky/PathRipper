import AjvModule, { type Ajv as AjvType, type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';
import type { FromSchema } from 'json-schema-to-ts';

type AjvCtor = new (opts?: ConstructorParameters<typeof AjvType>[0]) => AjvType;
type AddFormatsFn = (ajv: AjvType) => AjvType;

const Ajv        = (AjvModule        as unknown as { default?: AjvCtor }).default        ?? (AjvModule        as unknown as AjvCtor);
const addFormats = (addFormatsModule as unknown as { default?: AddFormatsFn }).default ?? (addFormatsModule as unknown as AddFormatsFn);

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

export const validateScrapedPage: ValidateFunction<ScrapedPageInterface> =
  ajv.compile<ScrapedPageInterface>(SCRAPED_PAGE_SCHEMA);

export function formatScrapedPageErrors(): string {
  return ajv.errorsText(validateScrapedPage.errors, { separator: '\n  ' });
}
