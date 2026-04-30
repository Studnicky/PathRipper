// Ported from @noocodec/cogitator/src/errors/BaseError.ts.
// Stripped of redact/JsonObject machinery — ripperoni's errors don't (yet)
// carry redaction schemas. Same shape, same protected constructor, same
// code-derivation rule, same flatten()/serialize()/toJson() surface.
export class BaseError extends Error {
    code;
    cause;
    metadata;
    retryable;
    constructor(message, options = {}) {
        super(message);
        this.name = this.constructor.name;
        this.cause = options.cause;
        this.metadata = options.metadata;
        this.retryable = options.retryable ?? false;
        this.code = options.code ?? BaseError.toCode(this.constructor.name);
    }
    static format(error) {
        if (error instanceof BaseError)
            return error.serialize();
        if (error instanceof Error)
            return error.message;
        return String(error);
    }
    toJson(options = {}) {
        const includeStack = options.stack !== false;
        const json = {
            code: this.code,
            message: this.message,
            name: this.name,
            retryable: this.retryable,
        };
        if (includeStack && this.stack !== undefined)
            json['stack'] = this.stack;
        if (this.metadata !== undefined)
            json['metadata'] = this.metadata;
        if (this.cause !== undefined) {
            if (this.cause instanceof BaseError) {
                json['cause'] = this.cause.toJson(options);
            }
            else {
                const causeObj = { message: this.cause.message, name: this.cause.name };
                if (includeStack && this.cause.stack !== undefined)
                    causeObj['stack'] = this.cause.stack;
                json['cause'] = causeObj;
            }
        }
        return json;
    }
    serialize() {
        return JSON.stringify(this.toJson(), null, 2);
    }
    flatten() {
        const chain = [this];
        let current = this.cause;
        while (current instanceof Error) {
            chain.push(current);
            current = 'cause' in current && current.cause instanceof Error ? current.cause : undefined;
        }
        return chain;
    }
    static toCode(name) {
        return name
            .replace(/([a-z])([A-Z])/g, '$1_$2')
            .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
            .toUpperCase();
    }
}
