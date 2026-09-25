// The artwork an Image-mode Material Test cell burns: five equal bands at 20,
// 40, 60, 80 and 100 % ink (luma 204/153/102/51/0), lightest first along the
// scan direction. A single flat tone would burn identically under every
// dither, so dithered and grayscale tests would look alike; the ramp shows
// how each cell's settings render tone, which is what an image test is for.
// `dataUrl` is the canvas display copy of exactly the bytes in `lumaBase64`
// (checked by material-test-ramp.test.ts).

export const MATERIAL_TEST_RAMP = {
  width: 40,
  height: 4,
  dataUrl:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAECAIAAABz8up3AAAAHElEQVR42mM4gwPMxAHScABjHIABFxi1mF4WAwDF/r9BK1zsmgAAAABJRU5ErkJggg==',
  lumaBase64:
    'zMzMzMzMzMyZmZmZmZmZmWZmZmZmZmZmMzMzMzMzMzMAAAAAAAAAAMzMzMzMzMzMmZmZmZmZmZlmZmZmZmZmZjMzMzMzMzMzAAAAAAAAAADMzMzMzMzMzJmZmZmZmZmZZmZmZmZmZmYzMzMzMzMzMwAAAAAAAAAAzMzMzMzMzMyZmZmZmZmZmWZmZmZmZmZmMzMzMzMzMzMAAAAAAAAAAA==',
} as const;
