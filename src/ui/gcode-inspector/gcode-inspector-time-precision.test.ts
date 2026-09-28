import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { SEG_KIND } from '../../core/gcode-view';
import { inspectGcodeSource } from './gcode-inspector-parse';
import { hasGcodeInspectorAnalysis } from './gcode-inspector-worker-protocol';

describe('Inspector arc timing precision', () => {
  it.each(['text', 'blob'] as const)(
    'retains true arc time after a long route in a %s source',
    async (kind) => {
      const radius = 0.1;
      const text = `G0 X8388608\nG0 X${radius}\nM400\nG3 X${radius} Y0 I-${radius} J0 F60`;
      const source =
        kind === 'text' ? { kind, text } : { kind, blob: new NodeBlob([text]) as unknown as Blob };
      const result = await inspectGcodeSource(source);
      if (!hasGcodeInspectorAnalysis(result)) throw new Error('Expected timed program');

      // The arc is the program's only cutting move; the worker sums its
      // seconds in double precision before the per-move arrays are dropped.
      const arcSeconds = result.analysis.time.kindSeconds[SEG_KIND.cut] ?? 0;
      // At 1 mm/s and the Inspector's 500 mm/s² acceleration, the true
      // circle's rest-to-rest time is its circumference plus v/a.
      expect(arcSeconds).toBeCloseTo(2 * Math.PI * radius + 0.002, 6);
    },
  );
});
