import * as three from 'three';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { describe, expect, it } from 'vitest';
import { SEG_KIND } from '../../core/gcode-view';
import {
  COLOR_STRIDE,
  createProgramGeometry,
  programColors,
  shareProgramGeometry,
  SHOWN_ATTRIBUTE,
  writeProgramColors,
} from './program-lines';
import type { Viewer3dTheme } from './viewer3d-theme';

const THEME: Viewer3dTheme = {
  background: 0x000000,
  gridMinor: 0x111111,
  gridMajor: 0x222222,
  travel: 0xcc4444,
  cut: 0x0000ff,
  plunge: 0x00ff00,
  retract: 0xff0000,
  arrow: 0xf2f4f8,
};

const SEGMENTS = {
  segmentCount: 4,
  positions: new Float32Array(24).map((_, index) => index),
  segKind: new Uint8Array([SEG_KIND.travel, SEG_KIND.plunge, SEG_KIND.cut, SEG_KIND.retract]),
};

function move(colors: Uint16Array, index: number): number[] {
  return [...colors.subarray(index * COLOR_STRIDE, (index + 1) * COLOR_STRIDE)];
}

describe('program lines (ADR-485)', () => {
  it('colours each solid move by kind and does not show rapids', () => {
    const { colors, shown } = programColors(SEGMENTS, THEME);
    expect(shown).toBe(3);
    expect(colors).toHaveLength(4 * COLOR_STRIDE);
    expect(move(colors, 0)).toEqual([0, 0, 0, 0]);
    expect(move(colors, 1)).toEqual([0, 0xffff, 0, 0xffff]);
    expect(move(colors, 2)).toEqual([0, 0, 0xffff, 0xffff]);
    expect(move(colors, 3)).toEqual([0xffff, 0, 0, 0xffff]);
  });

  it('does not show moves a legend filter leaves out', () => {
    const { colors, shown } = programColors(
      { ...SEGMENTS, visible: new Uint8Array([1, 1, 0, 1]) },
      THEME,
    );
    expect(shown).toBe(2);
    expect(move(colors, 2)).toEqual([0, 0, 0, 0]);
  });

  it('repaints shown moves in place, encoded, and leaves the rest alone', () => {
    const { colors } = programColors(SEGMENTS, THEME);
    const asked: number[] = [];
    writeProgramColors(
      colors,
      (index) => (asked.push(index), [0.5, 0.25, 1]),
      (channel) => channel / 2,
    );
    expect(asked).toEqual([1, 2, 3]);
    expect(move(colors, 0)).toEqual([0, 0, 0, 0]);
    expect(move(colors, 2)).toEqual([16384, 8192, 32768, 0xffff]);
  });

  it('draws from the program positions without copying them', () => {
    const { colors } = programColors(SEGMENTS, THEME);
    const { geometry } = createProgramGeometry(
      three,
      LineSegmentsGeometry,
      SEGMENTS.positions,
      colors,
    );
    const start = geometry.getAttribute('instanceStart') as three.InterleavedBufferAttribute;
    expect(start.data.array.buffer).toBe(SEGMENTS.positions.buffer);
    expect(geometry.instanceCount).toBe(4);
    const color = geometry.getAttribute('instanceColorStart') as three.InterleavedBufferAttribute;
    expect(color.data.array).toBe(colors);
    expect(color.normalized).toBe(true);
    expect(geometry.getAttribute('instanceColorEnd')).toBe(color);
    const shownFlag = geometry.getAttribute(SHOWN_ATTRIBUTE) as three.InterleavedBufferAttribute;
    expect(shownFlag.data).toBe(color.data);
    expect(shownFlag.offset).toBe(3);
    geometry.dispose();
  });

  it('shares the GPU buffers with a second geometry that draws every move', () => {
    const { colors } = programColors(SEGMENTS, THEME);
    const { geometry } = createProgramGeometry(
      three,
      LineSegmentsGeometry,
      SEGMENTS.positions,
      colors,
    );
    geometry.instanceCount = 1;
    const shared = shareProgramGeometry(LineSegmentsGeometry, geometry);
    for (const name of ['instanceStart', 'instanceEnd', SHOWN_ATTRIBUTE]) {
      expect(shared.getAttribute(name)).toBe(geometry.getAttribute(name));
    }
    expect(shared.instanceCount).toBe(4);
    expect(shared.boundingSphere?.radius).toBe(geometry.boundingSphere?.radius);
    geometry.dispose();
    shared.dispose();
  });
});
