// Applied-pixel golden for every Image Studio adjustment (perf audit S5-P2-1).
// The hashes were recorded from main at 45cbf63f9, before the dialog preview
// moved to display resolution: OK must still bake exactly these bytes, with
// and without a feathered selection, on a single layer and on an upper layer.

import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CurvePoint } from '../../core/image-adjust';
import type { RgbaBuffer } from '../../core/image-edit';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import type { SelectionMask } from '../../core/image-select';
import { useAdjustDialogStore } from './adjust-dialog-store';
import { ADJUSTMENTS, type AdjustmentId } from './editor-adjustments';
import { createSession, withSelection, type EditorSession } from './editor-session';
import { addLayerAboveActive, compositeSession } from './editor-session-layers';
import { useImageEditorStore } from './image-editor-store';

const W = 37;
const H = 23;
const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

const PARAMS: Record<AdjustmentId, Record<string, number>> = {
  'brightness-contrast': { brightness: 23, contrast: -17 },
  levels: { inBlack: 12, inWhite: 230, gamma: 1.4, outBlack: 5, outWhite: 250 },
  curves: {},
  threshold: { level: 100 },
  posterize: { levels: 5 },
  invert: {},
  desaturate: {},
  'remove-white-background': { cleanup: 30 },
  'gaussian-blur': { sigma: 1.5 },
  'unsharp-mask': { amount: 150, sigma: 1.5, threshold: 4 },
  'high-pass': { sigma: 2 },
  median: { radius: 2 },
  halftone: { spacing: 6, angle: 30 },
  'line-screen': { spacing: 5, angle: 15 },
};

const CURVE: readonly CurvePoint[] = [
  { x: 0, y: 10 },
  { x: 90, y: 140 },
  { x: 255, y: 240 },
];

// A deterministic "photo": smooth gradients plus a hashed speckle, with a
// near-white paper band so white removal has something to remove.
function photo(alphaOf: (x: number, y: number) => number): RgbaBuffer {
  const buffer = createRgbaBuffer(W, H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      const speckle = (x * 73 + y * 151 + ((x * y) % 17) * 29) % 61;
      const paper = y < 4;
      buffer.data[i] = paper ? 250 - (x % 5) : (x * 7 + speckle) % 256;
      buffer.data[i + 1] = paper ? 252 : (y * 11 + speckle * 2) % 256;
      buffer.data[i + 2] = paper ? 249 : ((x + y) * 5 + speckle * 3) % 256;
      buffer.data[i + 3] = alphaOf(x, y);
    }
  }
  return buffer;
}

function featheredSelection(): SelectionMask {
  const alpha = new Uint8Array(W * H);
  for (let y = 3; y < 19; y += 1) {
    for (let x = 5; x < 31; x += 1) {
      const edge = Math.min(x - 5, 30 - x, y - 3, 18 - y);
      alpha[y * W + x] = Math.min(255, 40 + edge * 60);
    }
  }
  return { width: W, height: H, alpha };
}

function singleLayer(): EditorSession {
  return createSession(
    'obj-golden',
    'golden.png',
    photo(() => 255),
    BOUNDS,
  );
}

// The active layer is an upper layer with soft alpha over the photo.
function upperLayer(): EditorSession {
  const session = addLayerAboveActive(singleLayer(), 'upper');
  session.doc.data.set(photo((x, y) => (x * 9 + y * 13) % 256).data);
  return session;
}

const CASES: Record<string, () => EditorSession> = {
  single: singleLayer,
  'single+selection': () => withSelection(singleLayer(), featheredSelection()),
  upper: upperLayer,
  'upper+selection': () => withSelection(upperLayer(), featheredSelection()),
};

function digest(bytes: Uint8ClampedArray): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

function applyThroughDialog(id: AdjustmentId, session: EditorSession): EditorSession {
  useImageEditorStore.setState({ session, transform: null });
  const store = useAdjustDialogStore.getState();
  store.open(id);
  if (useAdjustDialogStore.getState().dialog !== null) {
    store.setParams(PARAMS[id]);
    if (id === 'curves') store.setCurvePoints(CURVE);
    useAdjustDialogStore.getState().commit();
  }
  const applied = useImageEditorStore.getState().session;
  if (applied === null) throw new Error('session vanished');
  return applied;
}

beforeEach(() => {
  useAdjustDialogStore.setState({ dialog: null });
  useImageEditorStore.setState({ session: null, transform: null });
});

describe('applied adjustment pixels', () => {
  it('bake the same bytes as main for every adjustment, selection and layer case', () => {
    const hashes: Record<string, string> = {};
    for (const spec of ADJUSTMENTS) {
      for (const [name, make] of Object.entries(CASES)) {
        const applied = applyThroughDialog(spec.id, make());
        expect(applied.history.undoStack.length).toBeGreaterThan(0);
        hashes[`${spec.id} ${name}`] =
          `${digest(applied.doc.data)} ${digest(compositeSession(applied).data)}`;
      }
    }
    expect(hashes).toMatchInlineSnapshot(`
      {
        "brightness-contrast single": "756fc5bf2bcf3354 756fc5bf2bcf3354",
        "brightness-contrast single+selection": "280a0b2c30e9e742 280a0b2c30e9e742",
        "brightness-contrast upper": "7995be6eb3524e18 75ff4e9e4deb767a",
        "brightness-contrast upper+selection": "9e6da3532fdd6c80 824738c1f29ca28b",
        "curves single": "21ea643c5fb042a2 21ea643c5fb042a2",
        "curves single+selection": "b1c24a1f88f70a8d b1c24a1f88f70a8d",
        "curves upper": "c2c38575df1e5255 b1bc30e5eacc16f9",
        "curves upper+selection": "aec8c428ccf61411 b8d52f58043345e4",
        "desaturate single": "d899698734f4e689 d899698734f4e689",
        "desaturate single+selection": "ad20cb612f9f9585 ad20cb612f9f9585",
        "desaturate upper": "64bcff1c294e7445 6957ea6672e7eaae",
        "desaturate upper+selection": "0dd97ea65380563c 871a85d5e9865357",
        "gaussian-blur single": "ef8f914b93cc8079 ef8f914b93cc8079",
        "gaussian-blur single+selection": "b02c5a878b082e7c b02c5a878b082e7c",
        "gaussian-blur upper": "451502881fe8b3a2 25f884d4e8e6e64d",
        "gaussian-blur upper+selection": "99237329784e504e cc114fb571505ed0",
        "halftone single": "9eda1060eef13f15 9eda1060eef13f15",
        "halftone single+selection": "1699c40b38b6bc3e 1699c40b38b6bc3e",
        "halftone upper": "5a55c4746b624417 4b806b51cc33dccd",
        "halftone upper+selection": "44c3a73f45d6983c 391e1615a2ef8f45",
        "high-pass single": "45eb302bd509d004 45eb302bd509d004",
        "high-pass single+selection": "032a911b27c07a64 032a911b27c07a64",
        "high-pass upper": "9292cfd6b343b608 0a180645f150bd0f",
        "high-pass upper+selection": "3af6715bce6940ba 53981b312cc97357",
        "invert single": "971aca8c25cf371d 971aca8c25cf371d",
        "invert single+selection": "aaa4fdaa37a96656 aaa4fdaa37a96656",
        "invert upper": "6b71ac685dd84884 1db565a1e0536e3b",
        "invert upper+selection": "ecb073350a7c94c2 694bb542f43ac324",
        "levels single": "139613a6ada6e995 139613a6ada6e995",
        "levels single+selection": "b7eb28673ad265ec b7eb28673ad265ec",
        "levels upper": "530c3f82759a9885 77594f7caddeaac6",
        "levels upper+selection": "08cc47be50686c99 5060e030ca37d02f",
        "line-screen single": "0cbd7c8c997029ef 0cbd7c8c997029ef",
        "line-screen single+selection": "cfdaec4e451c893f cfdaec4e451c893f",
        "line-screen upper": "9634ed54e45c4976 51b35e57ce289bd4",
        "line-screen upper+selection": "ebdb4f74f8e92c08 e7688d94c464e538",
        "median single": "f703503010186ca9 f703503010186ca9",
        "median single+selection": "c8cbfb3fc3958def c8cbfb3fc3958def",
        "median upper": "4cd05b77e18cdfd6 8b374e6a147da7f4",
        "median upper+selection": "024efe75bf663822 c9607644970c2bb2",
        "posterize single": "7af6440523361635 7af6440523361635",
        "posterize single+selection": "2ce54d5e7a312651 2ce54d5e7a312651",
        "posterize upper": "1313fbf3f3da735d 2a9abc0cf24aa4f6",
        "posterize upper+selection": "e6e28fe8e0a06033 0b4057db92cb5827",
        "remove-white-background single": "edacc8c9ec304574 c880a8a706da3c39",
        "remove-white-background single+selection": "f10256768e25ec91 03da6a1128db4cef",
        "remove-white-background upper": "55a5ca4a5eb76bcf 8e079f93fec24e4d",
        "remove-white-background upper+selection": "98e4663fd6063512 1312bca5f8b9e749",
        "threshold single": "e581e922ea3f2b6d e581e922ea3f2b6d",
        "threshold single+selection": "2ae575923f3c924f 2ae575923f3c924f",
        "threshold upper": "1353ec30a5a5b357 5b25ce52c2d62f77",
        "threshold upper+selection": "19e9e1d3f5e6538f 45d25824a7de6198",
        "unsharp-mask single": "db9db3ec1bb5cf7f db9db3ec1bb5cf7f",
        "unsharp-mask single+selection": "149ad03d5da6ce89 149ad03d5da6ce89",
        "unsharp-mask upper": "a0f1810409168eb3 01a530dddc2646c5",
        "unsharp-mask upper+selection": "eedc4a821ebf4c9b 09c62fad33e1b32d",
      }
    `);
  });
});
