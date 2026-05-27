import { describe, expect, it } from 'vitest';
import { assertNever, IDENTITY_TRANSFORM } from './scene-object';

describe('IDENTITY_TRANSFORM', () => {
  it('represents zero translation, unit scale, no rotation, no mirror', () => {
    expect(IDENTITY_TRANSFORM).toEqual({
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      mirrorX: false,
      mirrorY: false,
    });
  });
});

describe('assertNever', () => {
  it('throws when called at runtime', () => {
    expect(() => assertNever('unexpected' as never)).toThrow(/Unhandled/);
  });

  it('uses the provided label in the error message', () => {
    expect(() => assertNever('bogus' as never, 'Origin')).toThrow(/Unhandled Origin/);
  });

  // The compile-time exhaustiveness gate is exercised by JobCompiler (when it
  // lands in core/job/) — that's the first consumer that pattern-matches over
  // SceneObject.kind, so its switch is where TS catches a missing arm. While
  // SceneObject has a single variant, TS can't narrow the `default` to `never`
  // on its own, so the gate doesn't usefully exist here yet.
  it('discriminates a synthetic two-variant union (general gate)', () => {
    type Foo = { kind: 'a'; n: number } | { kind: 'b'; s: string };
    // Wrap in a function so TS keeps the wider `Foo` type instead of
    // narrowing to the literal at the assignment site.
    const makeFoo = (): Foo => ({ kind: 'a', n: 1 });
    const x = makeFoo();
    let handled = '';
    switch (x.kind) {
      case 'a':
        handled = 'a';
        break;
      case 'b':
        handled = 'b';
        break;
      default:
        assertNever(x);
    }
    expect(handled).toBe('a');
  });
});
