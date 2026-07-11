import { describe, expect, it } from 'vitest';
import { err, ok, type Result } from './result';

describe('Result', () => {
  it('ok tags the value under the ok kind', () => {
    const result = ok(1);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.value).toBe(1);
  });

  it('err tags the error under the error kind', () => {
    const result = err('boom');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error).toBe('boom');
  });

  it('ok and err unify into one Result<T, E> for a caller to narrow', () => {
    const parse = (raw: string): Result<number, string> => {
      const value = Number(raw);
      return Number.isNaN(value) ? err(`not a number: ${raw}`) : ok(value);
    };
    expect(parse('42')).toEqual({ kind: 'ok', value: 42 });
    expect(parse('x')).toEqual({ kind: 'error', error: 'not a number: x' });
  });
});
