import { describe, expect, it } from 'vitest';
import { photoDisplaySize } from './outline-photo-canvas';

describe('photoDisplaySize', () => {
  it('keeps a landscape photo inside the display box without distortion', () => {
    expect(photoDisplaySize(2048, 1024)).toEqual({ width: 860, height: 430 });
  });

  it('limits portrait photos by height', () => {
    expect(photoDisplaySize(1000, 2000)).toEqual({ width: 280, height: 560 });
  });

  it('does not enlarge a small photo', () => {
    expect(photoDisplaySize(400, 300)).toEqual({ width: 400, height: 300 });
  });
});
