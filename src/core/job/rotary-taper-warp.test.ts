import { describe, expect, it, vi } from 'vitest';
import type { RotarySetup, RotaryTaper } from '../devices/rotary';
import { rotaryMeasurementsValid } from '../devices/rotary';
import type { CutGroup, Job, RasterGroup } from './job';
import { rasterRow, rasterRowsInProviderOrder } from './raster-rows';
import { restoreRotaryTaperPoint, warpRotaryTaperPoint } from './rotary-taper-profile';
import { applyRotaryTaperWarp, rotaryTaperProfile } from './rotary-taper-warp';

// ADR-694. Ø80 top, Ø70 bottom, 100 mm along the side, top on the left; the
// artwork's left edge sits at the rim.
const TAPER: RotaryTaper = {
  enabled: true,
  topDiameterMm: 80,
  bottomDiameterMm: 70,
  lengthMm: 100,
  topSide: 'left',
  artworkFromTopMm: 0,
};
const SETUP: RotarySetup = {
  enabled: true,
  type: 'chuck',
  mmPerRotation: 40,
  objectDiameterMm: 80,
  taper: TAPER,
};

function cutJob(polyline: ReadonlyArray<{ x: number; y: number }>, extra: Partial<Job> = {}): Job {
  const group: CutGroup = {
    kind: 'cut',
    layerId: 'L1',
    color: '#ff0000',
    power: 50,
    speed: 1000,
    passes: 1,
    airAssist: false,
    segments: [{ polyline, closed: false }],
  };
  return { groups: [group], ...extra };
}

function onlyCut(job: Job): CutGroup {
  const group = job.groups[0];
  if (group?.kind !== 'cut') throw new Error('cut group missing');
  return group;
}

function rasterJob(rows: number, provider?: (y: number) => Float64Array): Job {
  const group: RasterGroup = {
    kind: 'raster',
    layerId: 'image',
    color: '#808080',
    power: 30,
    speed: 1000,
    passes: 1,
    airAssist: false,
    sValues: provider === undefined ? new Float64Array(10 * rows).fill(7) : new Float64Array(0),
    ...(provider === undefined ? {} : { rowProvider: provider }),
    pixelWidth: 10,
    pixelHeight: rows,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: rows },
    overscanMm: 5,
    dotWidthCorrectionMm: 0,
  };
  return { groups: [group], rotaryAnchorY: 0 };
}

function onlyRaster(job: Job): RasterGroup {
  const group = job.groups[0];
  if (group?.kind !== 'raster') throw new Error('raster group missing');
  return group;
}

describe('rotary taper warp (ADR-694)', () => {
  it('returns the very same job without an active taper', () => {
    const job = cutJob([
      { x: 0, y: 0 },
      { x: 100, y: 20 },
    ]);
    const { taper: _none, ...straight } = SETUP;
    expect(applyRotaryTaperWarp(job, straight)).toBe(job);
    expect(applyRotaryTaperWarp(job, { ...SETUP, taper: { ...TAPER, enabled: false } })).toBe(job);
  });

  it('scales Y about the anchor by the reference radius over the local radius', () => {
    const job = cutJob(
      [
        { x: 0, y: 5 },
        { x: 100, y: 5 },
        { x: 100, y: 25 },
      ],
      { rotaryAnchorY: 5 },
    );
    const polyline = onlyCut(applyRotaryTaperWarp(job, SETUP)).segments[0]?.polyline ?? [];
    // The anchor row stays put: the edge along it needs no extra points.
    expect(polyline.slice(0, 2)).toEqual([
      { x: 0, y: 5 },
      { x: 100, y: 5 },
    ]);
    // At the base (r 35): 20 mm round the part is 20·40/35 mm at the Ø80 scale.
    expect(polyline).toHaveLength(3);
    expect(polyline[2]?.x).toBe(100);
    expect(polyline[2]?.y).toBeCloseTo(5 + (20 * 40) / 35, 9);
  });

  it('adds vertices where an edge along the part curves, and keeps contour indices', () => {
    const polyline = [
      { x: 0, y: 30 },
      { x: 100, y: 30 },
      { x: 100, y: 0 },
    ];
    const job: Job = {
      groups: [
        {
          ...onlyCut(cutJob(polyline)),
          segments: [{ polyline, closed: false, leadContour: { from: 1, to: 2 } }],
        },
      ],
      rotaryAnchorY: 0,
    };
    const warped = onlyCut(applyRotaryTaperWarp(job, SETUP)).segments[0];
    const contour = warped?.leadContour;
    if (warped === undefined || contour === undefined) throw new Error('lead contour missing');
    const { polyline: points } = warped;
    expect(points.length).toBeGreaterThan(3);
    expect(points[contour.from]).toMatchObject({ x: 100 });
    expect(points[contour.from]?.y).toBeCloseTo((30 * 40) / 35, 9);
    expect(points[contour.to]).toEqual({ x: 100, y: 0 });
    // Every densified point lies on the warped curve, so each chord is within
    // a micrometre of it.
    for (const point of points.slice(0, contour.from)) {
      expect(point.y).toBeCloseTo((30 * 40) / (40 - point.x / 20), 6);
    }
  });

  it('pivots an Absolute job on its middle row', () => {
    const job = cutJob([
      { x: 100, y: 10 },
      { x: 100, y: 30 },
    ]);
    expect(rotaryTaperProfile(job, SETUP)?.baseY).toBe(20);
  });

  it('places the cone from the top side and the gap to the artwork', () => {
    const job = cutJob([
      { x: 10, y: 0 },
      { x: 30, y: 0 },
    ]);
    const right = rotaryTaperProfile(job, {
      ...SETUP,
      taper: { ...TAPER, topSide: 'right', artworkFromTopMm: 30 },
    });
    // Top on the right: the artwork's right edge (X 30) is 30 mm from the top.
    expect(right).toMatchObject({ topX: 60, direction: -1 });
  });

  it('maps a frame outline back to the design exactly', () => {
    const profile = rotaryTaperProfile(
      cutJob([
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ]),
      SETUP,
    );
    if (profile === null) throw new Error('profile missing');
    for (const point of [
      { x: 0, y: 0 },
      { x: 37, y: 12 },
      { x: 100, y: 50 },
    ]) {
      const back = restoreRotaryTaperPoint(profile, warpRotaryTaperPoint(profile, point));
      expect(back.x).toBe(point.x);
      expect(back.y).toBeCloseTo(point.y, 9);
    }
  });

  it('warps the contour-entry bounds with the burn', () => {
    const job = cutJob(
      [
        { x: 0, y: 0 },
        { x: 100, y: 10 },
      ],
      { rotaryAnchorY: 0, contourEntryBounds: { minX: 0, minY: 0, maxX: 100, maxY: 10 } },
    );
    const bounds = applyRotaryTaperWarp(job, SETUP).contourEntryBounds;
    expect(bounds).toMatchObject({ minX: 0, minY: 0, maxX: 100 });
    expect(bounds?.maxY).toBeCloseTo((10 * 40) / 35, 9);
  });

  it('records the cone on the job for the feed match', () => {
    const job = cutJob([
      { x: 0, y: 0 },
      { x: 100, y: 10 },
    ]);
    expect(applyRotaryTaperWarp(job, SETUP).rotaryTaper).toMatchObject({
      referenceRadiusMm: 40,
      topRadiusMm: 40,
      bottomRadiusMm: 35,
      lengthMm: 100,
    });
  });

  it('refuses a cone whose ends are further apart than its side is long', () => {
    expect(rotaryMeasurementsValid(SETUP)).toBe(true);
    expect(rotaryMeasurementsValid({ ...SETUP, taper: { ...TAPER, lengthMm: 4 } })).toBe(false);
    expect(
      rotaryMeasurementsValid({ ...SETUP, taper: { ...TAPER, enabled: false, lengthMm: 4 } }),
    ).toBe(true);
  });
});

describe('rotary taper warp of raster rows (ADR-694)', () => {
  it('resamples rows so each column keeps its surface height', () => {
    // 10 columns over the whole taper, 10 rows of 1 mm from the anchor row.
    const warped = onlyRaster(applyRotaryTaperWarp(rasterJob(10), SETUP));
    // The narrow end grows to 10·40/35 = 11.43 mm, so 12 rows of 1 mm.
    expect(warped.pixelHeight).toBe(12);
    expect(warped.bounds).toMatchObject({ minX: 0, maxX: 100, minY: 0, maxY: 12 });
    const litRows = (column: number): number => {
      let lit = 0;
      for (let row = 0; row < warped.pixelHeight; row += 1) {
        if ((rasterRow(warped, row)[column] ?? 0) > 0) lit += 1;
      }
      return lit;
    };
    // Column 0 (X 5, r 39.75): 10·40/39.75 = 10.06 → 10 rows lit.
    expect(litRows(0)).toBe(10);
    // Column 9 (X 95, r 35.25): 10·40/35.25 = 11.35 → 11 rows lit.
    expect(litRows(9)).toBe(11);
    expect(rasterRow(warped, 11)[9]).toBe(0);
  });

  it('reads a streamed source forward, each row once', () => {
    const requested: number[] = [];
    const provider = vi.fn((y: number) => {
      requested.push(y);
      return new Float64Array(10).fill(y + 1);
    });
    const warped = onlyRaster(applyRotaryTaperWarp(rasterJob(50, provider), SETUP));
    const rows = [...rasterRowsInProviderOrder(warped)];
    expect(rows).toHaveLength(warped.pixelHeight);
    expect(requested).toEqual([...requested].sort((a, b) => a - b));
    expect(new Set(requested).size).toBe(requested.length);
  });

  it('keeps a descending provider order with the rows it names', () => {
    const job = rasterJob(10);
    const descending: Job = {
      ...job,
      groups: [{ ...onlyRaster(job), rowProviderOrder: 'descending-y' }],
    };
    const warped = onlyRaster(applyRotaryTaperWarp(descending, SETUP));
    expect(warped.rowProviderOrder).toBe('descending-y');
    expect(rasterRow(warped, 0)[0]).toBe(7);
    expect(rasterRow(warped, warped.pixelHeight - 1)[0]).toBe(0);
  });
});
