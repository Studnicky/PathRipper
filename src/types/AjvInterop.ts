import type { Ajv } from 'ajv';

/** AJV 8.x constructor type — default export under NodeNext ESM interop. */
export type AjvCtorType = new (opts?: ConstructorParameters<typeof Ajv>[0]) => Ajv;

/** ajv-formats addFormats callable — default export under NodeNext ESM interop. */
export interface AddFormatsFnInterface {
  (ajv: Ajv): Ajv;
}
