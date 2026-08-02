import { JsonTokenType, type JsonToken } from './json-tokenizer';

const NO_VALUE = Symbol('no JSON value');

type ObjectFrame = {
  readonly kind: 'object';
  readonly value: Record<string, unknown>;
  state: 'key-or-end' | 'key' | 'colon' | 'value' | 'comma-or-end';
  key?: string;
};

type ArrayFrame = {
  readonly kind: 'array';
  readonly value: unknown[];
  state: 'value-or-end' | 'value' | 'comma-or-end';
};

type Frame = ObjectFrame | ArrayFrame;

/** Builds the same ordinary object/array graph as JSON.parse from validated tokens. */
export class JsonValueAssembler {
  private readonly stack: Frame[] = [];
  private root: unknown | typeof NO_VALUE = NO_VALUE;
  private rootComplete = false;

  public write({ token, value }: JsonToken): void {
    const frame = this.stack.at(-1);
    if (frame === undefined) {
      if (this.rootComplete) throw unexpected(token, 'after the top-level value');
      this.writeValue(token, value);
      return;
    }
    if (frame.kind === 'object') this.writeObject(frame, token, value);
    else this.writeArray(frame, token, value);
  }

  public end(): void {
    if (!this.rootComplete || this.stack.length !== 0) {
      throw new Error('JSON input ended before the top-level value was complete');
    }
  }

  public value(): unknown {
    if (!this.rootComplete || this.root === NO_VALUE) {
      throw new Error('JSON input did not contain a value');
    }
    return this.root;
  }

  private writeObject(frame: ObjectFrame, token: JsonTokenType, value: unknown): void {
    if (frame.state === 'key-or-end') {
      if (token === JsonTokenType.RIGHT_BRACE) {
        this.close(frame);
        return;
      }
      this.writeObjectKey(frame, token, value);
      return;
    }
    if (frame.state === 'key') {
      this.writeObjectKey(frame, token, value);
      return;
    }
    if (frame.state === 'colon') {
      if (token !== JsonTokenType.COLON) {
        throw unexpected(token, 'while expecting an object colon');
      }
      frame.state = 'value';
      return;
    }
    if (frame.state === 'value') {
      this.writeValue(token, value);
      return;
    }
    if (token === JsonTokenType.COMMA) {
      frame.state = 'key';
      return;
    }
    if (token === JsonTokenType.RIGHT_BRACE) {
      this.close(frame);
      return;
    }
    throw unexpected(token, 'while expecting an object comma or end');
  }

  private writeObjectKey(frame: ObjectFrame, token: JsonTokenType, value: unknown): void {
    if (token !== JsonTokenType.STRING || typeof value !== 'string') {
      throw unexpected(token, 'while expecting an object key');
    }
    frame.key = value;
    frame.state = 'colon';
  }

  private writeArray(frame: ArrayFrame, token: JsonTokenType, value: unknown): void {
    if (frame.state === 'value-or-end' && token === JsonTokenType.RIGHT_BRACKET) {
      this.close(frame);
      return;
    }
    if (frame.state === 'value-or-end' || frame.state === 'value') {
      this.writeValue(token, value);
      return;
    }
    if (token === JsonTokenType.COMMA) {
      frame.state = 'value';
      return;
    }
    if (token === JsonTokenType.RIGHT_BRACKET) {
      this.close(frame);
      return;
    }
    throw unexpected(token, 'while expecting an array comma or end');
  }

  private writeValue(token: JsonTokenType, value: unknown): void {
    if (token === JsonTokenType.LEFT_BRACE) {
      const object: Record<string, unknown> = {};
      this.assign(object);
      this.stack.push({ kind: 'object', value: object, state: 'key-or-end' });
      return;
    }
    if (token === JsonTokenType.LEFT_BRACKET) {
      const array: unknown[] = [];
      this.assign(array);
      this.stack.push({ kind: 'array', value: array, state: 'value-or-end' });
      return;
    }
    if (
      token === JsonTokenType.STRING ||
      token === JsonTokenType.NUMBER ||
      token === JsonTokenType.TRUE ||
      token === JsonTokenType.FALSE ||
      token === JsonTokenType.NULL
    ) {
      this.assign(value);
      if (this.stack.length === 0) this.rootComplete = true;
      return;
    }
    throw unexpected(token, 'while expecting a JSON value');
  }

  private assign(value: unknown): void {
    const parent = this.stack.at(-1);
    if (parent === undefined) {
      this.root = value;
      return;
    }
    if (parent.kind === 'array') {
      parent.value.push(value);
      parent.state = 'comma-or-end';
      return;
    }
    const key = parent.key;
    if (key === undefined) throw new Error('JSON object value has no key');
    Object.defineProperty(parent.value, key, {
      value,
      configurable: true,
      enumerable: true,
      writable: true,
    });
    delete parent.key;
    parent.state = 'comma-or-end';
  }

  private close(frame: Frame): void {
    if (this.stack.at(-1) !== frame) throw new Error('JSON container stack mismatch');
    this.stack.pop();
    if (this.stack.length === 0) this.rootComplete = true;
  }
}

function unexpected(token: JsonTokenType, context: string): Error {
  return new Error(`Unexpected ${JsonTokenType[token]} ${context}`);
}
