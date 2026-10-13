import { expect, it } from 'vitest';
import type { CutGroup, FillGroup } from './job';
import { cutPathsArtwork } from './cut-paths-artwork';

const cut: CutGroup = {
  kind: 'cut',
  layerId: 'cut',
  color: '#000000',
  power: 30,
  speed: 1000,
  passes: 1,
  airAssist: false,
  segments: [
    {
      closed: true,
      polyline: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 0, y: 0 },
      ],
    },
  ],
};
it('keeps final-pass overcut as an open extension and excludes zero-power paths', () => {
  const result = cutPathsArtwork(
    {
      groups: [
        { ...cut, finalPassOvercutMm: 2 },
        { ...cut, power: 0 },
      ],
    },
    (p) => p,
  );
  const lines = result.paths[0]?.polylines;
  expect(lines).toHaveLength(1);
  expect(lines?.[0]?.closed).toBe(false);
  expect(lines?.[0]?.points.at(-1)).toEqual({ x: 2, y: 0 });
});
it('uses the calibrated fill sweep and excludes laser-off runways', () => {
  const fill: FillGroup = {
    ...cut,
    kind: 'fill',
    overscanMm: 3,
    bidirectionalScanOffsetMm: 1,
    segments: [
      {
        closed: false,
        reverse: true,
        polyline: [
          { x: 10, y: 5 },
          { x: 0, y: 5 },
        ],
      },
    ],
  };
  const result = cutPathsArtwork({ groups: [fill] }, (p) => p);
  expect(result.paths[0]?.polylines).toEqual([
    {
      closed: false,
      points: [
        { x: 9, y: 5 },
        { x: -1, y: 5 },
      ],
    },
  ]);
});
