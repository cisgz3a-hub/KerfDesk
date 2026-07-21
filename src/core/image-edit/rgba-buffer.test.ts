import { describe, expect, it } from 'vitest';
import {
  cloneRgbaBuffer,
  createRgbaBuffer,
  RGBA_CHANNELS,
  rgbaBuffersEqual,
  WHITE_BYTE,
} from './rgba-buffer';

describe('createRgbaBuffer', () => {
  it('creates an opaque-white buffer of the requested size', () => {
    const buffer = createRgbaBuffer(3, 2);
    expect(buffer.width).toBe(3);
    expect(buffer.height).toBe(2);
    expect(buffer.data.length).toBe(3 * 2 * RGBA_CHANNELS);
    expect(buffer.data.every((byte) => byte === WHITE_BYTE)).toBe(true);
  });

  it('floors fractional dimensions and clamps to at least 1 px', () => {
    const fractional = createRgbaBuffer(4.9, 2.1);
    expect(fractional.width).toBe(4);
    expect(fractional.height).toBe(2);

    const degenerate = createRgbaBuffer(0, -5);
    expect(degenerate.width).toBe(1);
    expect(degenerate.height).toBe(1);
    expect(degenerate.data.length).toBe(RGBA_CHANNELS);
  });
});

describe('cloneRgbaBuffer', () => {
  it('copies every byte and shares no storage with the source', () => {
    const source = createRgbaBuffer(2, 2);
    source.data[0] = 7;
    const clone = cloneRgbaBuffer(source);

    expect(rgbaBuffersEqual(source, clone)).toBe(true);
    clone.data[0] = 200;
    expect(source.data[0]).toBe(7);
    expect(rgbaBuffersEqual(source, clone)).toBe(false);
  });
});

describe('rgbaBuffersEqual', () => {
  it('rejects dimension mismatches even when byte lengths agree', () => {
    const wide = createRgbaBuffer(4, 2);
    const tall = createRgbaBuffer(2, 4);
    expect(rgbaBuffersEqual(wide, tall)).toBe(false);
  });

  it('detects a single-channel difference', () => {
    const a = createRgbaBuffer(2, 2);
    const b = cloneRgbaBuffer(a);
    b.data[b.data.length - 1] = 0;
    expect(rgbaBuffersEqual(a, b)).toBe(false);
  });
});
