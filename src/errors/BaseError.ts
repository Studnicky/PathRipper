// Ported from @noocodec/cogitator/src/errors/BaseError.ts.
// Stripped of redact/JsonObject machinery — ripperoni's errors don't (yet)
// carry redaction schemas. Same shape, same protected constructor, same
// code-derivation rule, same flatten()/serialize()/toJson() surface.

export interface BaseErrorOptionsInterface {
  readonly code?:      string | undefined;
  readonly cause?:     Error | undefined;
  readonly metadata?:  Readonly<Record<string, unknown>> | undefined;
  readonly retryable?: boolean | undefined;
}

export type BaseErrorJsonType = Readonly<{
  readonly code:      string;
  readonly message:   string;
  readonly name:      string;
  readonly retryable: boolean;
  readonly stack?:    string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly cause?:    BaseErrorJsonType | { readonly message: string; readonly name: string; readonly stack?: string };
}>;

export class BaseError extends Error {
  public readonly code:      string;
  public override readonly cause: Readonly<Error> | undefined;
  public readonly metadata:  Readonly<Record<string, unknown>> | undefined;
  public readonly retryable: boolean;

  protected constructor(message: string, options: BaseErrorOptionsInterface = {}) {
    super(message);
    this.name      = this.constructor.name;
    this.cause     = options.cause;
    this.metadata  = options.metadata;
    this.retryable = options.retryable ?? false;
    this.code      = options.code ?? BaseError.toCode(this.constructor.name);
  }

  public static format(error: unknown): string {
    if (error instanceof BaseError) return error.serialize();
    if (error instanceof Error)     return error.message;
    return String(error);
  }

  public toJson(options: Readonly<{ stack?: boolean }> = {}): BaseErrorJsonType {
    const includeStack = options.stack !== false;
    const json: Record<string, unknown> = {
      code:      this.code,
      message:   this.message,
      name:      this.name,
      retryable: this.retryable,
    };
    if (includeStack && this.stack !== undefined) json['stack'] = this.stack;
    if (this.metadata !== undefined)              json['metadata'] = this.metadata;
    if (this.cause !== undefined) {
      if (this.cause instanceof BaseError) {
        json['cause'] = this.cause.toJson(options);
      } else {
        const causeObj: Record<string, unknown> = { message: this.cause.message, name: this.cause.name };
        if (includeStack && this.cause.stack !== undefined) causeObj['stack'] = this.cause.stack;
        json['cause'] = causeObj;
      }
    }
    return json as unknown as BaseErrorJsonType;
  }

  public serialize(): string {
    return JSON.stringify(this.toJson(), null, 2);
  }

  public flatten(): Error[] {
    const chain: Error[] = [this];
    let current: Error | undefined = this.cause;
    while (current instanceof Error) {
      chain.push(current);
      current = 'cause' in current && current.cause instanceof Error ? current.cause : undefined;
    }
    return chain;
  }

  private static toCode(name: string): string {
    return name
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .toUpperCase();
  }
}
