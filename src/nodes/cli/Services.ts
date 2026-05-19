import type { Logger } from '../../modules/logger/logger.js';

/**
 * Services injected into CLI-layer nodes via `context.services`.
 *
 * @remarks
 * CLI nodes operate at a different abstraction layer than scrape nodes —
 * they dispatch `RipperRun` runs rather than performing HTTP work directly.
 * `CliServices` intentionally does not include scrapers, caches, or a
 * dispatcher reference; those live in `RipperServices` (scrape layer).
 *
 * @category Services
 * @since 3.1.0
 */
export interface CliServices {
  /** Logger instance for CLI-level diagnostics. */
  readonly log: Logger;
}
