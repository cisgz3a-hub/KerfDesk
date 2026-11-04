import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CurvePoint } from '../../core/image-adjust';
import type { RgbaBuffer } from '../../core/image-edit';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import type { SelectionMask } from '../../core/image-select';
import {
  computeWindowPreview,
  previewWindow,
  sampleWindowInto,
  selectionBounds,
  type AdjustPreviewCache,
  type PreviewWindow,
} from './adjust-preview-window';
import { commitAdjustment } from './editor-adjust-session';
import { ADJUSTMENTS, defaultParams, type AdjustmentId } from './editor-adjustments';
import { createSession, withSelection, type EditorSession } from './editor-session';
import { addLayerAboveActive, compositeSession } from './editor-session-layers';

const W = 41;
const H = 29;
const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
const CURVE: readonly CurvePoint[] = [
  { x: 0, y: 30 },
  { x: 128, y: 90 },
  { x: 255, y: 220 },
];

function photo(alphaOf: (x: number, y: number) => number): RgbaBuffer {
  const buffer = createRgbaBuffer(W, H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      const speckle = (x * 37 + y * 101) % 53;
      buffer.data[i] = y < 3 ? 251 : (x * 9 + speckle) % 256;
      buffer.data[i + 1] = y < 3 ? 253 : (y * 13 + speckle) % 256;
      buffer.data[i + 2] = y < 3 ? 250 : ((x + y) * 6 + speckle * 2) % 256;
      buffer.data[i + 3] = alphaOf(x, y);
    }
  }
  return buffer;
}

function feathered(): SelectionMask {
  const alpha = new Uint8Array(W * H);
  for (let y = 4; y < 24; y += 1) {
    for (let x = 6; x < 33; x += 1) {
      alpha[y * W + x] = Math.min(255, 50 + Math.min(x - 6, 32 - x, y - 4, 23 - y) * 70);
    }
  }
  return { width: W, height: H, alpha };
}

function single(): EditorSession {
  return createSession(
    'obj-window',
    'window.png',
    photo(() => 255),
    BOUNDS,
  );
}

function upper(): EditorSession {
  const session = addLayerAboveActive(single(), 'upper');
  session.doc.data.set(photo((x, y) => (x * 11 + y * 7) % 256).data);
  return session;
}

const CASES: Record<string, () => EditorSession> = {
  single,
  'single+selection': () => withSelection(single(), feathered()),
  upper,
  'upper+selection': () => withSelection(upper(), feathered()),
};

function paramsFor(id: AdjustmentId): Record<string, number> {
  const spec = ADJUSTMENTS.find((entry) => entry.id === id);
  if (spec === undefined) throw new Error(id);
  // Off-default values, so every adjustment visibly changes pixels.
  const params = defaultParams(spec);
  for (const param of spec.params) {
    params[param.key] = Math.min(param.max, param.defaultValue + param.step * 3);
  }
  return params;
}

function crop(buffer: RgbaBuffer, win: PreviewWindow): Uint8ClampedArray {
  const out = createRgbaBuffer(win.rect.width, win.rect.height);
  sampleWindowInto(buffer, { ...win, width: win.rect.width, height: win.rect.height }, out);
  return out.data;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('previewWindow', () => {
  it('is the visible part of the document, sized at the view scale but never above 1:1', () => {
    const doc = { width: 4000, height: 3000 };
    const fit = previewWindow(
      doc,
      { scale: 0.25, panX: 20, panY: 10 },
      { width: 1040, height: 770 },
      null,
    );
    expect(fit?.rect).toEqual({ x: 0, y: 0, width: 4000, height: 3000 });
    expect([fit?.width, fit?.height]).toEqual([1000, 750]);
    const zoomed = previewWindow(
      doc,
      { scale: 2, panX: -1000, panY: -600 },
      { width: 800, height: 600 },
      null,
    );
    expect(zoomed?.rect).toEqual({ x: 500, y: 300, width: 401, height: 301 });
    expect([zoomed?.width, zoomed?.height]).toEqual([401, 301]);
  });

  it('clips to the selection bounds and is null when nothing is on screen', () => {
    const doc = { width: 100, height: 100 };
    const view = { scale: 1, panX: 0, panY: 0 };
    const clip = { x: 10, y: 20, width: 30, height: 40 };
    expect(previewWindow(doc, view, { width: 500, height: 500 }, clip)?.rect).toEqual(clip);
    const away = { scale: 1, panX: 900, panY: 0 };
    expect(previewWindow(doc, away, { width: 500, height: 500 }, null)).toBeNull();
  });
});

describe('sampleWindowInto', () => {
  it('averages colour weighted by alpha so transparent pixels never bleed in', () => {
    const source = createRgbaBuffer(2, 1);
    source.data.set([0, 0, 0, 0, 200, 100, 50, 255]);
    const target = createRgbaBuffer(1, 1);
    sampleWindowInto(
      source,
      { rect: { x: 0, y: 0, width: 2, height: 1 }, width: 1, height: 1 },
      target,
    );
    expect([...target.data]).toEqual([200, 100, 50, 128]);
  });
});

describe('computeWindowPreview', () => {
  // At 1:1 the window preview is a crop of what OK bakes, byte for byte,
  // for every adjustment, selection and layer case (ADR-245 Amendment 1).
  it.each(Object.keys(CASES))('equals the committed composite at 1:1 (%s)', (name) => {
    const make = CASES[name] ?? single;
    for (const spec of ADJUSTMENTS) {
      const session = make();
      const win = previewWindow(
        session.doc,
        { scale: 2, panX: -14, panY: -10 },
        { width: 50, height: 30 },
        selectionBounds(session.selection),
      );
      if (win === null) throw new Error('window off screen');
      expect(win.width).toBe(win.rect.width);
      const request = { id: spec.id, params: paramsFor(spec.id), curvePoints: CURVE };
      const preview = computeWindowPreview({ current: null }, session, request, win);
      const committed = commitAdjustment(make(), spec.id, request.params, CURVE);
      expect([spec.id, ...preview.data]).toEqual([
        spec.id,
        ...crop(compositeSession(committed), win),
      ]);
    }
  });

  it.each(['levels', 'gaussian-blur'] as const)(
    'reuses one display-sized buffer and allocates nothing document-sized per %s step',
    (id) => {
      const bigSession = createSession('obj-big', 'big.png', createRgbaBuffer(400, 300), BOUNDS);
      const big = bigSession.doc;
      const win = previewWindow(
        big,
        { scale: 0.25, panX: 0, panY: 0 },
        { width: 100, height: 75 },
        null,
      );
      if (win === null) throw new Error('window off screen');
      expect(win.width * win.height).toBeLessThanOrEqual(100 * 75);
      const cache: AdjustPreviewCache = { current: null };
      const first = computeWindowPreview(cache, bigSession, { id, params: paramsFor(id) }, win);
      let large = 0;
      const Native = Uint8ClampedArray;
      vi.stubGlobal(
        'Uint8ClampedArray',
        new Proxy(Native, {
          construct(target, args: unknown[]) {
            const made = Reflect.construct(target, args) as Uint8ClampedArray;
            if (made.length >= big.data.length) large += 1;
            return made;
          },
        }),
      );
      for (const step of [1, 2, 3]) {
        const params = { ...paramsFor(id), gamma: 1 + step / 10, sigma: 1 + step };
        expect(computeWindowPreview(cache, bigSession, { id, params }, win)).toBe(first);
      }
      expect(large).toBe(0);
    },
  );
});
