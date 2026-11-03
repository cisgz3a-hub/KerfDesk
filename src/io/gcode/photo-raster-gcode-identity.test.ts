// UX audit U3-P2-3 (ADR-581 Amendment 1): the photo preview's new budget and
// the allocation-free luma decoder change no burned byte. These hashes were
// recorded from main before the change; a photo that already previewed emits
// exactly the same raster G-code commands.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ciBudgetMs } from '../../__fixtures__/ci-budget';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type DitherAlgorithm,
  type SceneObject,
} from '../../core/scene';
import { emitGcode } from './emit-gcode';

const JARVIS = '85f6c2bbe6ed5937e9cd941e2fddc93dba4a56d2a80ecd3cbfcc1f15f1cc2f19';
const STUCKI = '25628e0492b76275534405dac2eda9261bc56702fc10e72db9b5f89316186c9e';
const GRAYSCALE = '271967dcbe2a3f71bd66db4b7daef7e80a136cbc5f9bac28ef2ea32281a07361';
const WIDTH = 160;
const HEIGHT = 120;

function photoLumaBase64(lineBreaks: boolean): string {
  const luma = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      luma[y * WIDTH + x] = Math.round(127.5 + 100 * Math.sin(x / 13) * Math.cos(y / 11));
    }
  }
  const base64 = Buffer.from(luma).toString('base64');
  // Saved projects and older importers may wrap base64 at 76 characters.
  return lineBreaks ? (base64.match(/.{1,76}/g) ?? []).join('\r\n') : base64;
}

function photoGcodeHash(algorithm: DitherAlgorithm, lineBreaks: boolean): string {
  const base = createProject();
  const color = '#808080';
  const photo: SceneObject = {
    kind: 'raster-image',
    id: 'P1',
    color,
    source: 'phone.jpg',
    dataUrl: 'data:image/jpeg;base64,unused',
    lumaBase64: photoLumaBase64(lineBreaks),
    pixelWidth: WIDTH,
    pixelHeight: HEIGHT,
    dither: algorithm,
    linesPerMm: 10,
    bounds: { minX: 10, minY: 10, maxX: 50, maxY: 40 },
    transform: IDENTITY_TRANSFORM,
    gamma: 1.4,
    contrast: 20,
  };
  const project = {
    ...base,
    scene: addLayer(addObject(base.scene, photo), {
      ...createLayer({ id: color, color, mode: 'image' }),
      ditherAlgorithm: algorithm,
      linesPerMm: 10,
      power: 40,
    }),
  };
  const { gcode, preflight } = emitGcode(project);
  expect(preflight.issues).toEqual([]);
  // Commands only: header and comment wording may change; burned bytes may not.
  const commands = gcode
    .split('\n')
    .filter((line) => !line.startsWith(';') && !line.startsWith('('))
    .join('\n');
  expect(commands).toMatch(/S[1-9]/);
  return createHash('sha256').update(commands).digest('hex');
}

describe('photo raster G-code is unchanged by the preview budget (U3-P2-3)', () => {
  it.each([
    ['jarvis', false, JARVIS],
    ['jarvis', true, JARVIS],
    ['stucki', false, STUCKI],
    ['grayscale', false, GRAYSCALE],
  ] as const)(
    '%s (line breaks %s) emits the bytes main emitted',
    { timeout: ciBudgetMs(30_000, 90_000) },
    (algorithm, breaks, hash) => {
      expect(photoGcodeHash(algorithm, breaks)).toBe(hash);
    },
  );
});
