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
    return new Promise<void>((resolve: () => void): void => {
      const clamped = Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
      setTimeout(resolve, clamped);
    });
  }
}
