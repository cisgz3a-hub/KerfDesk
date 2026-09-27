import { describe, expect, it } from 'vitest';
import {
  encodePickIds,
  nearestEnd,
  nearestPickedSegment,
  PICK_WINDOW_PX,
  SNAP_PX,
} from './pick-ids';

// A read-back square with the given pixels painted, as the pick pass returns it.
function square(size: number, painted: ReadonlyArray<[column: number, row: number, id: number]>) {
  const pixels = new Uint8Array(size * size * 4);
  for (const [column, row, id] of painted) {
    const at = (row * size + column) * 4;
    pixels[at] = id % 256;
    pixels[at + 1] = Math.floor(id / 256) % 256;
    pixels[at + 2] = Math.floor(id / 256 ** 2) % 256;
    pixels[at + 3] = Math.floor(id / 256 ** 3) % 256;
  }
  return pixels;
}

describe('encodePickIds', () => {
  it('paints both ends of each move with its segment index plus one', () => {
    const bytes = encodePickIds(new Uint32Array([0, 5]));
    expect([...bytes]).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 6, 0, 0, 0, 6, 0, 0, 0]);
  });

  it('round-trips indices past what three colour bytes can hold', () => {
    const indices = [0, 255, 256, 65_535, 16_777_215, 16_777_216, 40_000_000];
    const bytes = encodePickIds(new Uint32Array(indices));
    indices.forEach((index, entry) => {
      const vertex = bytes.subarray(entry * 8, entry * 8 + 4);
      const pixels = new Uint8Array(4);
      pixels.set(vertex);
      expect(nearestPickedSegment(pixels, 1)).toBe(index);
    });
  });
});

describe('nearestPickedSegment', () => {
  it('names nothing over empty space', () => {
    expect(nearestPickedSegment(square(PICK_WINDOW_PX, []), PICK_WINDOW_PX)).toBeNull();
  });

  it('prefers the move drawn nearest the pointer at the centre', () => {
    const centre = (PICK_WINDOW_PX - 1) / 2;
    const pixels = square(PICK_WINDOW_PX, [
      [0, 0, 8],
      [centre + 2, centre, 4],
      [centre, centre - 1, 3],
      [PICK_WINDOW_PX - 1, PICK_WINDOW_PX - 1, 9],
    ]);
    expect(nearestPickedSegment(pixels, PICK_WINDOW_PX)).toBe(2);
  });

  it('still finds a move at the edge of the window', () => {
    const pixels = square(PICK_WINDOW_PX, [[PICK_WINDOW_PX - 1, 0, 12]]);
    expect(nearestPickedSegment(pixels, PICK_WINDOW_PX)).toBe(11);
  });
});

describe('nearestEnd', () => {
  const start = { x: 100, y: 100 };
  const end = { x: 200, y: 100 };

  it('snaps to an end within reach and to nothing past it', () => {
    expect(nearestEnd({ x: 106, y: 108 }, start, end)).toBe('start');
    expect(nearestEnd({ x: 195, y: 100 }, start, end)).toBe('end');
    expect(nearestEnd({ x: 150, y: 100 }, start, end)).toBeNull();
    expect(nearestEnd({ x: 100, y: 100 + SNAP_PX + 1 }, start, end)).toBeNull();
  });

  it('picks the nearer end of a move shorter than the reach', () => {
    expect(nearestEnd({ x: 104, y: 100 }, start, { x: 106, y: 100 })).toBe('end');
    expect(nearestEnd({ x: 101, y: 100 }, start, { x: 106, y: 100 })).toBe('start');
  });

  it('ignores an end that is off screen', () => {
    expect(nearestEnd({ x: 101, y: 100 }, null, end)).toBeNull();
    expect(nearestEnd({ x: 199, y: 100 }, null, end)).toBe('end');
    expect(nearestEnd({ x: 0, y: 0 }, null, null)).toBeNull();
  });
});
