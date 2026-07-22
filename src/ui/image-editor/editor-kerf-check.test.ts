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

function projectWithDotWidth(
  dotWidthCorrectionMm: number,
  kerfOffsetMm = 0,
  linesPerMm = 0.1,
): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      objects: [raster()],
      layers: [
        {
          ...createLayer({ id: 'L1', color: '#808080', mode: 'image' }),
          dotWidthCorrectionMm,
          kerfOffsetMm,
          linesPerMm,
        },
      ],
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
  it('flags a horizontal raster run that dot-width correction fully removes', () => {
    const check = computeKerfCheck(strokesSession(), projectWithDotWidth(3));
    expect(check).not.toBeNull();
    if (check === null) return;
    expect(check.thresholdMm).toBe(3);
    // Each row of the 1-px vertical hairline is a 1 mm run and is removed;
    // the 10 mm block remains wider than 2 × the 3 mm correction.
    expect(check.removedMask.alpha[30 * 60 + 10]).toBe(255);
    expect(check.removedPixels).toBeGreaterThan(0);
    expect(check.removedMask.alpha[35 * 60 + 35]).toBe(0);
  });

  it('ignores line-mode kerf offset and returns null without dot-width correction', () => {
    expect(computeKerfCheck(strokesSession(), projectWithDotWidth(0, 3))).toBeNull();
  });

  it('uses the same line-interval clamp as raster compilation', () => {
    const check = computeKerfCheck(strokesSession(), projectWithDotWidth(3, 0, 1));
    expect(check?.thresholdMm).toBe(1);
  });

  it('does not call a long horizontal hairline removed merely because it is one pixel tall', () => {
    const session = strokesSession();
    for (let x = 5; x < 55; x += 1) {
      const base = (2 * 60 + x) * 4;
      session.doc.data[base] = 0;
      session.doc.data[base + 1] = 0;
      session.doc.data[base + 2] = 0;
    }
    const check = computeKerfCheck(session, projectWithDotWidth(3));
    expect(check?.removedMask.alpha[2 * 60 + 30]).toBe(0);
  });

  it('applyThicken repairs the thin strokes as one undoable entry', () => {
    const session = strokesSession();
    useImageEditorStore.setState({ session });
    const check = computeKerfCheck(session, projectWithDotWidth(3));
    if (check === null) throw new Error('expected a check');
    applyThicken(check);
    const next = useImageEditorStore.getState().session;
    expect(next?.history.undoStack.at(-1)?.label).toBe('Thicken dot-width runs');
    // Re-checking the thickened document finds no thin strokes left.
    const recheck = computeKerfCheck(next ?? session, projectWithDotWidth(3));
    expect(recheck?.removedPixels).toBe(0);
  });
});
