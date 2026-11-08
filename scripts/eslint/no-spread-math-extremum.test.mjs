import test from 'node:test';
import { RuleTester } from 'eslint';
import { noSpreadMathExtremum } from './no-spread-math-extremum.mjs';

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });

test('no array spread into Math.min / Math.max (audit S7-P2-3)', () => {
  tester.run('no-spread-math-extremum', noSpreadMathExtremum, {
    valid: [
      'Math.min(a, b);',
      'Math.max(0, Math.min(1, value));',
      'minOf(points.map((point) => point.x));',
      'maxOf(xs);',
      'other.min(...values);',
      'Math.hypot(...vector);',
    ],
    invalid: [
      // text-on-path.ts and text-bend.ts before the fix.
      { code: 'const minX = Math.min(...xs);', errors: [{ messageId: 'spread' }] },
      {
        code: 'const maxY = Math.max(...points.map((point) => point.y));',
        errors: [{ messageId: 'spread' }],
      },
      { code: 'Math.min(...results, cap);', errors: [{ messageId: 'spread' }] },
    ],
  });
});
