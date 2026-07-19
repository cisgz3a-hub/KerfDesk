import { describe, expect, it } from 'vitest';
import type { Toolpath } from '../../core/job';
import {
  buildPreviewTimeline,
  elapsedSecondsAtScrubber,
  scrubberAtElapsedSeconds,
} from './preview-timeline';

const mixed: Toolpath = {
  totalLength: 200,
  steps: [
    {
      kind: 'cut',
      color: '#000000',
      length: 100,
      polyline: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    },
    { kind: 'travel', from: { x: 100, y: 0 }, to: { x: 200, y: 0 }, length: 100 },
  ],
};

describe('preview timeline', () => {
  it('paces rapid and laser-off feed travel from separate timing buckets', () => {
    const detailed: Toolpath = {
      totalLength: 300,
      steps: [
        mixed.steps[0]!,
        {
          kind: 'travel',
          motion: 'rapid',
          from: { x: 100, y: 0 },
          to: { x: 200, y: 0 },
          length: 100,
        },
        {
          kind: 'travel',
          motion: 'feed',
          from: { x: 200, y: 0 },
          to: { x: 300, y: 0 },
          length: 100,
        },
      ],
    };
    const timeline = buildPreviewTimeline(detailed, {
      cutSeconds: 60,
      travelSeconds: 30,
      rapidTravelSeconds: 20,
      feedTravelSeconds: 10,
    });

    expect(elapsedSecondsAtScrubber(timeline, 1 / 3)).toBeCloseTo(60, 8);
    expect(elapsedSecondsAtScrubber(timeline, 2 / 3)).toBeCloseTo(80, 8);
    expect(scrubberAtElapsedSeconds(timeline, 70)).toBeCloseTo(0.5, 8);
    expect(scrubberAtElapsedSeconds(timeline, 85)).toBeCloseTo(5 / 6, 8);
  });

  it('allocates equal distances according to estimated cut and travel time', () => {
    const timeline = buildPreviewTimeline(mixed, { cutSeconds: 90, travelSeconds: 10 });

    expect(elapsedSecondsAtScrubber(timeline, 0.5)).toBeCloseTo(90, 8);
    expect(scrubberAtElapsedSeconds(timeline, 50)).toBeCloseTo(50 / 90 / 2, 8);
    expect(scrubberAtElapsedSeconds(timeline, 95)).toBeCloseTo(0.75, 8);
  });

  it('roundtrips elapsed time and scrubber position across mixed steps', () => {
    const timeline = buildPreviewTimeline(mixed, { cutSeconds: 90, travelSeconds: 10 });

    for (const t of [0, 0.1, 0.49, 0.5, 0.75, 1]) {
      expect(scrubberAtElapsedSeconds(timeline, elapsedSecondsAtScrubber(timeline, t))).toBeCloseTo(
        t,
        8,
      );
    }
  });

  it('stays finite for empty and malformed timing input', () => {
    const timeline = buildPreviewTimeline(
      { steps: [], totalLength: 0 },
      {
        cutSeconds: Number.NaN,
        travelSeconds: -1,
      },
    );

    expect(elapsedSecondsAtScrubber(timeline, 0.5)).toBe(0);
    expect(scrubberAtElapsedSeconds(timeline, 10)).toBe(0);
  });
});
