// Perf audit S1, S3-P3-1: projects of 25 MiB or more are read by this
// tokenizer, and nearly all of such a file is base64 photo data inside
// strings. String text is taken a run at a time, not a character at a time.

import { describe, expect, it, vi } from 'vitest';
import { JsonTokenizer, type JsonToken } from './json-tokenizer';

type Stepping = { consumeCharacter: (character: string) => boolean };

function tokens(chunks: ReadonlyArray<string>): JsonToken[] {
  const tokenizer = new JsonTokenizer();
  const seen: JsonToken[] = [];
  tokenizer.onToken = (token) => seen.push(token);
  for (const chunk of chunks) tokenizer.write(chunk);
  tokenizer.end();
  return seen;
}

describe('JsonTokenizer string runs (perf audit S3-P3-1)', () => {
  it('reads a megabyte of base64 in a handful of steps, not one per character', () => {
    const photo = 'iVBORw0KGgoAAAANSUhEUgAA+/='.repeat(40_000);
    const source = JSON.stringify({ kind: 'image', data: photo, escaped: 'a"b\\c☃' });
    const steps = vi.spyOn(JsonTokenizer.prototype as unknown as Stepping, 'consumeCharacter');
    const chunks = source.match(/[\s\S]{1,65536}/g) ?? [];
    const read = tokens(chunks);
    expect(read.find((token) => token.value === photo)).toBeDefined();
    expect(read.find((token) => token.value === 'a"b\\c☃')).toBeDefined();
    // Punctuation, quotes, the escapes and the run ends between chunks.
    expect(steps.mock.calls.length).toBeLessThan(100);
    steps.mockRestore();
  });

  it('still refuses a control character inside a run', () => {
    expect(() => tokens(['"abc', 'def\u0001ghi"'])).toThrow(
      'Unescaped control character in JSON string',
    );
  });
});
