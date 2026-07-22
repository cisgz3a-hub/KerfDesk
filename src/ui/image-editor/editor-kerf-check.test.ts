import { beforeEach, describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { applyThicken, computeKerfCheck } from './editor-kerf-check';
import { createSession } from './editor-session';
import { useImageEditorStore } from './image-editor-store';

// 60×60 px on 60×60 mm (1 px = 1 mm).
const BOUNDS = { minX: 0, minY: 0, maxX: 60, maxY: 60 };

function raster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'source.png',
    dataUrl: 'data:image/png;base64,source',
    pixelWidth: 60,
    pixelHeight: 60,
    bounds: BOUNDS,
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
    lumaBase64: 'AAA=',
  };
}

function projectWithKerf(kerfOffsetMm: number): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      objects: [raster()],
      layers: [{ ...createLayer({ id: 'L1', color: '#808080', mode: 'image' }), kerfOffsetMm }],
    },
  };
}

// A 1-px vertical hairline at x=10 and a solid 10×10 block at (30..39, 30..39).
function strokesSession() {
  const doc = createRgbaBuffer(60, 60);
  const ink = (x: number, y: number): void => {
    const base = (y * 60 + x) * 4;
    doc.data[base] = 0;
    doc.data[base + 1] = 0;
    doc.data[base + 2] = 0;
  };
  for (let y = 5; y < 55; y += 1) ink(10, y);
  for (let y = 30; y < 40; y += 1) for (let x = 30; x < 40; x += 1) ink(x, y);
  return createSession('R1', 'source.png', doc, BOUNDS);
}

beforeEach(() => {
  useImageEditorStore.setState({ session: null, transform: null });
});

describe('computeKerfCheck', () => {
  it('flags the hairline but not the solid block', () => {
    const check = computeKerfCheck(strokesSession(), projectWithKerf(3));
    expect(check).not.toBeNull();
    if (check === null) return;
    expect(check.thresholdMm).toBe(3);
    // The 1-px hairline dies under a 3 mm opening; the 10 px block survives.
    expect(check.thinMask.alpha[(30 * 60 + 10) & 0x7fffffff]).toBeDefined();
    expect(check.thinPixels).toBeGreaterThan(0);
    expect(check.thinMask.alpha[35 * 60 + 35]).toBe(0); // block centre not thin
  });

  it('returns null when the layer declares no kerf or dot width', () => {
    expect(computeKerfCheck(strokesSession(), projectWithKerf(0))).toBeNull();
  });

  it('applyThicken repairs the thin strokes as one undoable entry', () => {
    const session = strokesSession();
    useImageEditorStore.setState({ session });
    const check = computeKerfCheck(session, projectWithKerf(3));
    if (check === null) throw new Error('expected a check');
    applyThicken(check);
    const next = useImageEditorStore.getState().session;
    expect(next?.history.undoStack.at(-1)?.label).toBe('Thicken thin strokes');
    // Re-checking the thickened document finds no thin strokes left.
    const recheck = computeKerfCheck(next ?? session, projectWithKerf(3));
    expect(recheck?.thinPixels).toBe(0);
  });
});
