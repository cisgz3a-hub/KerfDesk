import { describe, expect, it } from 'vitest';
import { PREVIEW_MAX_EDGE_PX } from './image-loader';

describe('image-loader trace preview sizing', () => {
  it('uses the commit-sized decode cap so preview and committed trace see the same pixels', () => {
    expect(PREVIEW_MAX_EDGE_PX).toBe(1024);
  });
});
