export class Time {
  private constructor() { /* static-only */ }

  public static sleep(ms: number): Promise<void> {
    return new Promise((resolve: () => void) => setTimeout(resolve, ms));
  }
}
