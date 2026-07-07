import { describe, expect, it } from 'vitest';

import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type TracedImage,
} from '../../core/scene';
import { drawScene } from './draw-scene';

function countingContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly calls: { lineTo: number; fillText: string[] };
} {
  const calls = { lineTo: 0, fillText: [] as string[] };
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'lineTo') {
          return () => {
            calls.lineTo += 1;
          };
        }
        if (prop === 'fillText') {
          return (text: string) => {
            calls.fillText.push(text);
          };
        }
        if (prop === 'measureText') return () => ({ width: 280 });
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, calls };
}

function tracedLineProject(segmentCount: number): Project {
  const points = Array.from({ length: segmentCount + 1 }, (_, x) => ({ x, y: 0 }));
  const traced: TracedImage = {
    kind: 'traced-image',
    id: 'trace-1',
    source: 'trace.png',
    traceMode: 'centerline',
    bounds: { minX: 0, minY: 0, maxX: segmentCount, maxY: 0 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines: [{ closed: false, points }] }],
  };
  const project = createProject();
  return {
    ...project,
    scene: {
      layers: [createLayer({ id: '#000000', color: '#000000', mode: 'line' })],
      objects: [traced],
    },
  };
}

describe('drawScene large vector traces', () => {
  it('draws a traced-logo-sized scene at full fidelity (no simplification)', () => {
    // The old 10k budget simplified a SINGLE traced logo (~10.3k segments)
    // into disconnected dashes — the 2026-07-05 "what is this?" report. A
    // 30k-segment scene must now draw every segment, with no notice.
    const { ctx, calls } = countingContext();

    drawScene(ctx, 800, 600, tracedLineProject(30_000), {
      selectedId: null,
      preview: false,
      view: { zoomFactor: 1, panX: 0, panY: 0 },
    });

    // The trace contributes exactly 30k lineTo; the bed grid adds a small
    // constant number on top.
    expect(calls.lineTo).toBeGreaterThanOrEqual(30_000);
    expect(calls.lineTo).toBeLessThan(31_000);
    expect(calls.fillText).not.toContain('Large scene - display simplified for performance');
  });

  it('decimates a genuinely oversized trace into CONNECTED coarse polylines', () => {
    const { ctx, calls } = countingContext();

    drawScene(ctx, 800, 600, tracedLineProject(250_000), {
      selectedId: null,
      preview: false,
      view: { zoomFactor: 1, panX: 0, panY: 0 },
    });

    // stride ceil(250k/120k)=3 keeps every 3rd vertex plus the endpoint:
    // far fewer lineTo than the raw trace, but each surviving vertex stays
    // CONNECTED to the next (one open polyline in, one decimated polyline
    // out → lineTo ≈ kept points - 1, not isolated dash pairs).
    expect(calls.lineTo).toBeGreaterThan(50_000);
    expect(calls.lineTo).toBeLessThan(90_000);
    expect(calls.fillText).toContain('Large scene - display simplified for performance');
  });
});
