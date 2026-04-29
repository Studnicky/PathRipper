/** Static utility for time-related async operations. */


export class Time {
  private constructor() { /* static-only */ }

  /**
   * Returns a Promise that resolves after the given number of milliseconds.
   *
   * @param ms - Duration to sleep in milliseconds.
   * @returns Promise that resolves after `ms` milliseconds.
   */
  public static sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve): void => { setTimeout(resolve, ms); });
  }
}
