/** A node's parsed extraction output (`state.output`), narrowed for assertions. */
export class ParsedOutput {
  /**
   * Read `state.output` as the concrete output type the driven concept emits.
   * `state.output` is the generic parsed-output bag (`object | null`); a test
   * knows the concrete shape. This is the single deserialization-boundary
   * narrowing point, so call sites read `ParsedOutput.as<ActionOutput>(state.output)`.
   */
  static as<TOutput>(output: object | null): TOutput {
    return output as unknown as TOutput;
  }
}
