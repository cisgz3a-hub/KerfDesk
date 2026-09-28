import { describe, expect, it } from 'vitest';
import { jobWatchRegion, watchPixelsPerMm } from './job-area';
import { maskComponents } from './mask-components';
import { maskGrid, routeMaskBuilder } from './route-mask';
import {
  addTimelapseFrame,
  droppedFrames,
  emptyTimelapse,
  timelapseFrameDue,
  timelapseVideoSeconds,
} from './timelapse-frames';

describe('jobWatchRegion', () => {
  it('grows the job bounds by the margin and keeps them on the bed', () => {
    const region = jobWatchRegion(
      [
        { x: 5, y: 40 },
        { x: 60, y: 90 },
      ],
      { width: 400, height: 95 },
    );
    expect(region).toEqual({ x: 0, y: 30, width: 70, height: 65 });
  });

  it('is null for a job with no points', () => {
    expect(jobWatchRegion([], { width: 400, height: 400 })).toBeNull();
  });
});

describe('watchPixelsPerMm', () => {
  const limits = { maxPixelsPerMm: 4, maxSidePx: 1024, maxPixels: 4_000_000 };

  it('keeps full detail for a small job', () => {
    expect(watchPixelsPerMm({ x: 0, y: 0, width: 100, height: 50 }, limits)).toBe(4);
  });

  it('lowers the detail so the longer side fits', () => {
    expect(watchPixelsPerMm({ x: 0, y: 0, width: 512, height: 100 }, limits)).toBe(2);
  });
});

describe('routeMaskBuilder', () => {
  it('draws an unbroken path even when the beam is thinner than a pixel', () => {
    const grid = maskGrid({ x: 0, y: 0, width: 20, height: 20 }, 2);
    if (grid === null) throw new Error('grid');
    const builder = routeMaskBuilder(grid, 0.1, 1);
    builder.addLine(1.3, 1.1, 18.7, 17.9);
    const { path, zone } = builder.masks();
    const groups = maskComponents(path.data, path.width, path.height);
    expect(groups.sizes).toHaveLength(1);
    // The zone is the path plus a millimetre (two pixels) either side.
    const pathCount = path.data.reduce((sum, value) => sum + value, 0);
    const zoneCount = zone.data.reduce((sum, value) => sum + value, 0);
    expect(zoneCount).toBeGreaterThan(pathCount * 3);
    for (let i = 0; i < path.data.length; i += 1) {
      if (path.data[i] === 1) expect(zone.data[i]).toBe(1);
    }
  });

  it('marks a zone-only stretch as allowed but not checked', () => {
    const grid = maskGrid({ x: 0, y: 0, width: 10, height: 10 }, 4);
    if (grid === null) throw new Error('grid');
    const builder = routeMaskBuilder(grid, 0.2, 1);
    builder.addLine(1, 5, 9, 5, true);
    const { path, zone } = builder.masks();
    expect(path.data.every((value) => value === 0)).toBe(true);
    expect(zone.data.some((value) => value === 1)).toBe(true);
  });

  it('draws a beam wider than a pixel at its width', () => {
    const grid = maskGrid({ x: 0, y: 0, width: 10, height: 10 }, 10);
    if (grid === null) throw new Error('grid');
    const builder = routeMaskBuilder(grid, 1, 0);
    builder.addLine(1, 5, 9, 5);
    const { path } = builder.masks();
    // A column across the middle of the line: 1 mm wide at 10 px/mm.
    let column = 0;
    for (let y = 0; y < path.height; y += 1) column += path.data[y * path.width + 50] ?? 0;
    expect(column).toBe(10);
  });
});

describe('maskComponents', () => {
  it('groups 8-connected pixels and notes which reach the edge', () => {
    // prettier-ignore
    const mask = new Uint8Array([
      1, 0, 0, 0, 0,
      0, 1, 0, 0, 0,
      0, 0, 0, 1, 0,
      0, 0, 0, 1, 0,
      0, 0, 0, 0, 0,
    ]);
    const groups = maskComponents(mask, 5, 5);
    expect(groups.sizes).toEqual([2, 2]);
    expect(groups.touchesEdge).toEqual([true, false]);
    expect(groups.labels[6]).toBe(0);
    expect(groups.labels[13]).toBe(1);
  });
});

describe('timelapse frames', () => {
  it('keeps a frame once per interval', () => {
    const start = emptyTimelapse<string>(1000);
    expect(timelapseFrameDue(start, 0)).toBe(true);
    const one = addTimelapseFrame(start, 'a', 0);
    expect(timelapseFrameDue(one, 999)).toBe(false);
    expect(timelapseFrameDue(one, 1000)).toBe(true);
  });

  it('halves the frames and doubles the interval at the limit, keeping the newest', () => {
    let timelapse = emptyTimelapse<number>(1000);
    for (let frame = 0; frame < 4; frame += 1) {
      timelapse = addTimelapseFrame(timelapse, frame, frame * 1000, 4);
    }
    const full = timelapse;
    timelapse = addTimelapseFrame(timelapse, 4, 4000, 4);
    expect(timelapse.frames).toEqual([0, 2, 4]);
    expect(timelapse.intervalMs).toBe(2000);
    expect(droppedFrames(full, timelapse)).toEqual([1, 3]);
    expect(timelapseFrameDue(timelapse, 5000)).toBe(false);
    expect(timelapseFrameDue(timelapse, 6000)).toBe(true);
  });

  it('says how long the video runs', () => {
    expect(timelapseVideoSeconds(480)).toBe(32);
  });
});
