// The sample counter behind the Abort-promptness guard in
// run-gcode-file-abort.e2e.ts. It needs no browser: it pins that a sampled
// frame named like an Object.prototype member is not a watched pass, which
// turned main's Browser smoke red three times (code-quality audit C2 D7-P2-1).

import { expect, test } from '@playwright/test';
import { functionSampleCounts, type ProfileNode } from './fixtures/profile-function-samples';

function frame(id: number, functionName: string, children: number[] = []): ProfileNode {
  return { id, callFrame: { functionName }, children };
}

const WATCHED = ['reviewExternalProgram', 'findLitRapids', 'runReviewProfileProbe'];

test('inherited Object.prototype names are not counted as watched passes', () => {
  const inherited = [
    'toString',
    'constructor',
    'valueOf',
    'hasOwnProperty',
    'toLocaleString',
    '__proto__',
    '__defineGetter__',
  ];
  const nodes = [
    frame(1, '(root)', [2, ...inherited.map((_, index) => 10 + index)]),
    frame(2, 'runReviewProfileProbe'),
    ...inherited.map((name, index) => frame(10 + index, name)),
  ];
  const samples = [2, ...inherited.map((_, index) => 10 + index)];
  const counts = functionSampleCounts({ nodes, samples }, WATCHED);
  expect(Object.fromEntries(counts)).toEqual({
    reviewExternalProgram: 0,
    findLitRapids: 0,
    runReviewProfileProbe: 1,
  });
});

test('a watched pass counts once per sample, wherever it is on the stack', () => {
  // (root) → reviewExternalProgram → toString → reviewExternalProgram (recursion)
  const nodes = [
    frame(1, '(root)', [2, 5]),
    frame(2, 'reviewExternalProgram', [3]),
    frame(3, 'toString', [4]),
    frame(4, 'reviewExternalProgram'),
    frame(5, 'findLitRapids'),
  ];
  const counts = functionSampleCounts({ nodes, samples: [4, 3, 5, 1] }, WATCHED);
  expect(counts.get('reviewExternalProgram')).toBe(2);
  expect(counts.get('findLitRapids')).toBe(1);
  expect(counts.get('runReviewProfileProbe')).toBe(0);
  expect(counts.has('toString')).toBe(false);
  expect(functionSampleCounts({ nodes }, WATCHED).get('findLitRapids')).toBe(0);
});
