/**
 * Static utility for time-related async operations within the http module.
 *
 * @remarks
 * All methods are static; the class cannot be instantiated.
 * Negative or non-finite `ms` values are clamped to zero rather than throwing.
 *
 * @example
 * ```ts
 * await Time.sleep(250); // pause for 250 ms
 * ```
 *
 * @category HTTP
 * @since 2.0.0
 * @see {@link RateLimiter}
 * @group Core
 */
export class Time {
  private constructor() { /* static-only */ }

  /**
   * Returns a Promise that resolves after the given number of milliseconds.
   *
   * @param millis - Duration to sleep in milliseconds. Must be >= 0.
   * @returns Promise that resolves after `millis` milliseconds.
   * @throws {RangeError} When `millis` is negative.
   */
  public static sleep(millis: number): Promise<void> {
    return new Promise<void>((resolve: () => void): void => {
      const clamped = Number.isFinite(millis) && millis > 0 ? Math.floor(millis) : 0;
      setTimeout(resolve, clamped);
    });
  }
}
