import { describe, expect, it } from 'vitest';

import * as trace from './index';

describe('core/trace public surface', () => {
  it('does not expose raster dither helpers through Trace Image', () => {
    expect(Object.hasOwn(trace, 'DITHER_MODES')).toBe(false);
    expect(Object.hasOwn(trace, 'ditherForTrace')).toBe(false);
  });
});
