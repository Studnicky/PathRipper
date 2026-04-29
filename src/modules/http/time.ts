/** Static utility for time-related async operations within the http module. */

export class Time {
  private constructor() { /* static-only */ }

  /**
   * Returns a Promise that resolves after the given number of milliseconds.
   *
   * @param ms - Duration to sleep in milliseconds. Must be >= 0.
   * @returns Promise that resolves after `ms` milliseconds.
   * @throws {RangeError} When `ms` is negative.
   */
  public static sleep(ms: number): Promise<void> {
    if (ms < 0) throw new RangeError('sleep ms must be >= 0');
    return new Promise<void>((resolve: () => void): void => { setTimeout(resolve, ms); });
  }
}
