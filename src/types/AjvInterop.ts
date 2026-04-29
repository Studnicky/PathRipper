import type { Ajv } from 'ajv';

/**
 * AJV 8.x constructor type — default export under NodeNext ESM interop.
 *
 * @remarks Used to handle the `{ default?: AjvCtor }` dual-export shape of the `ajv` package.
 * @example
 * ```ts
 * const Ajv = (AjvModule as unknown as { default?: AjvCtorType }).default ?? AjvModule;
 * ```
 * @category Schema
 * @since 2.0.0
 * @group Schema
 * @see AddFormatsFnInterface
 */
export type AjvCtorType = new (opts?: ConstructorParameters<typeof Ajv>[0]) => Ajv;

/**
 * `ajv-formats` `addFormats` callable — default export under NodeNext ESM interop.
 *
 * @remarks Used to handle the `{ default?: addFormats }` dual-export shape of `ajv-formats`.
 * @example
 * ```ts
 * const addFormats = (addFormatsModule as unknown as { default?: AddFormatsFnInterface }).default ?? addFormatsModule;
 * addFormats(ajv);
 * ```
 * @category Schema
 * @since 2.0.0
 * @group Schema
 * @see AjvCtorType
 */
export interface AddFormatsFnInterface {
  (ajv: Ajv): Ajv;
}
