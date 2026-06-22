/**
 * BaseError — structured base class for all squashage domain errors.
 *
 * Auto-derives a SCREAMING_SNAKE_CASE code from the subclass name, carries an
 * optional cause chain, typed metadata, and a retryable flag. Serializes to a
 * stable JSON shape via `toJson()` / `serialize()`.
 */

import type { BaseErrorOptionsInterface, BaseErrorJsonType } from '../types/BaseError.js';

export type { BaseErrorOptionsInterface, BaseErrorJsonType };

export class BaseError extends Error {
  /** SCREAMING_SNAKE_CASE error code — auto-derived from the class name unless overridden. */
  public readonly code:      string;
  /** Underlying error that caused this one, if any. */
  public override readonly cause: Readonly<Error> | undefined;
  /** Arbitrary structured metadata attached to the error. */
  public readonly metadata:  Readonly<Record<string, unknown>> | undefined;
  /** Whether the operation that produced this error can be retried. */
  public readonly retryable: boolean;

  protected constructor(message: string, options: BaseErrorOptionsInterface = {}) {
    super(message);
    this.name      = this.constructor.name;
    this.cause     = options.cause;
    this.metadata  = options.metadata;
    this.retryable = options.retryable ?? false;
    this.code      = options.code ?? BaseError.#toCode(this.constructor.name);
  }

  /** Create a `BaseError` instance directly (subclasses use their own static `create()`). */
  public static create(message: string, options?: BaseErrorOptionsInterface): BaseError {
    return new BaseError(message, options);
  }

  /** Format any thrown value to a string — `BaseError` serializes fully, plain `Error` uses `.message`. */
  public static format(error: unknown): string {
    if (error instanceof BaseError) return error.serialize();
    if (error instanceof Error) return error.message;
    return String(error);
  }

  static #toCode(name: string): string {
    return name
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .toUpperCase();
  }

  /** JSON-serializable representation including nested cause chain. */
  public toJson(options: Readonly<{ stack?: boolean }> = {}): BaseErrorJsonType {
    const includeStack = options.stack !== false;
    const json: Record<string, unknown> = {
      code:      this.code,
      message:   this.message,
      name:      this.name,
      retryable: this.retryable,
    };
    if (includeStack) json['stack'] = this.stack;
    if (this.metadata !== undefined) json['metadata'] = this.metadata;
    if (this.cause !== undefined) {
      json['cause'] = this.cause instanceof BaseError
        ? this.cause.toJson(options)
        : { message: this.cause.message, name: this.cause.name, ...(includeStack ? { stack: this.cause.stack } : {}) };
    }
    return json as BaseErrorJsonType;
  }

  /** Stable JSON string of `toJson()`. */
  public serialize(): string {
    return JSON.stringify(this.toJson(), null, 2);
  }

  /** Flat array of this error and every cause in the chain. */
  public flatten(): Error[] {
    const chain: Error[] = [this];
    let current: Error | undefined = this.cause;
    while (current instanceof Error) {
      chain.push(current);
      current = 'cause' in current && current.cause instanceof Error ? current.cause : undefined;
    }
    return chain;
  }
}
