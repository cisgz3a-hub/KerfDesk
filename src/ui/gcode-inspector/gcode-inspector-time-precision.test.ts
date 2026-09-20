import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
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

      let arcSeconds = 0;
      for (let index = 0; index < result.parsed.model.segmentCount; index += 1) {
        if (result.parsed.model.segLine[index] === 3) {
          arcSeconds += result.analysis.time.segSeconds[index] ?? 0;
        }
      }
      // At 1 mm/s and the Inspector's 500 mm/s² acceleration, the true
      // circle's rest-to-rest time is its circumference plus v/a.
      expect(arcSeconds).toBeCloseTo(2 * Math.PI * radius + 0.002, 6);
    },
  );
});
