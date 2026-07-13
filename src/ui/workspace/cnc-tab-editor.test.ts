import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
import { hitCncTabAnchor } from './cnc-tab-editor';

const OBJECT: ImportedSvg = {
  kind: 'imported-svg',
  id: 'part',
  source: 'part.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  cncTabAnchors: [{ layerColor: '#ff0000', pathIndex: 0, polylineIndex: 0, pathT: 0.125 }],
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
        },
      ],
    },
  ],
};

describe('CNC tab canvas handles', () => {
  it('hits the persisted marker at a stable screen-space radius', () => {
    expect(hitCncTabAnchor(OBJECT, '#ff0000', { x: 5.5, y: 0 }, 0.1)).toEqual({
      kind: 'cnc-tab',
      anchorIndex: 0,
      layerColor: '#ff0000',
    });
    expect(hitCncTabAnchor(OBJECT, '#ff0000', { x: 8, y: 0 }, 0.1)).toBeNull();
  });
});
