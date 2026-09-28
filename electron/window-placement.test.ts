import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WINDOW_SIZE,
  parseSavedWindowPlacement,
  restoredWindowPlacement,
  serializeWindowPlacement,
} from './window-placement';

const LAPTOP = { x: 0, y: 0, width: 1920, height: 1040 };
const RIGHT_MONITOR = { x: 1920, y: 0, width: 2560, height: 1400 };

describe('main window placement', () => {
  it('opens at the default size the first time', () => {
    expect(restoredWindowPlacement(null, [LAPTOP])).toEqual({
      bounds: DEFAULT_WINDOW_SIZE,
      maximized: false,
    });
  });

  it('reopens where the operator left it, maximized state included', () => {
    const saved = { x: 2100, y: 80, width: 1600, height: 1000, maximized: true };
    expect(restoredWindowPlacement(saved, [LAPTOP, RIGHT_MONITOR])).toEqual({
      bounds: { x: 2100, y: 80, width: 1600, height: 1000 },
      maximized: true,
    });
  });

  it('drops a position no screen shows any more, keeping a size that fits', () => {
    const saved = { x: 2100, y: 80, width: 2400, height: 1300, maximized: false };
    expect(restoredWindowPlacement(saved, [LAPTOP])).toEqual({
      bounds: { width: 1920, height: 1040 },
      maximized: false,
    });
  });

  it('drops a position whose title strip is off screen', () => {
    const saved = { x: 100, y: -500, width: 1200, height: 800, maximized: false };
    expect(restoredWindowPlacement(saved, [LAPTOP]).bounds).toEqual({ width: 1200, height: 800 });
  });

  it('keeps a window that overlaps two screens when one shows its title strip', () => {
    const saved = { x: 1800, y: 100, width: 1200, height: 800, maximized: false };
    expect(restoredWindowPlacement(saved, [LAPTOP, RIGHT_MONITOR]).bounds).toEqual({
      x: 1800,
      y: 100,
      width: 1200,
      height: 800,
    });
  });

  it('round-trips through its file and ignores damaged or foreign files', () => {
    const saved = { x: -8, y: -8, width: 1936, height: 1056, maximized: true };
    expect(parseSavedWindowPlacement(serializeWindowPlacement(saved))).toEqual(saved);
    for (const text of [
      '',
      'not json',
      'null',
      '[]',
      '{"x":0,"y":0,"width":1280,"height":800}',
      '{"x":0.5,"y":0,"width":1280,"height":800,"maximized":false}',
      '{"x":0,"y":0,"width":50,"height":800,"maximized":false}',
      '{"x":0,"y":0,"width":"1280","height":800,"maximized":false}',
    ]) {
      expect(parseSavedWindowPlacement(text), text).toBeNull();
    }
  });
});
