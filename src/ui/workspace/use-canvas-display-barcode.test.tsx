import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readCode128 } from '../../__fixtures__/barcode/linear-decoders';
import { decodeQrModules } from '../../__fixtures__/barcode/qr-decoder';
import { sampleGrid, sampleScanLine } from '../../__fixtures__/barcode/sample-geometry';
import {
  defaultBarcodeSpec,
  isBarcodeObject,
  type BarcodeObject,
  type BarcodeSymbology,
} from '../../core/barcode';
import {
  IDENTITY_TRANSFORM,
  type Polyline,
  type Project,
  type SceneObject,
  type ShapeObject,
} from '../../core/scene';
import type { VariableTextRenderer } from '../../io/gcode/prepare-output-snapshot';
import { materializeVariableText } from '../../io/gcode/prepare-output-snapshot';
import { draftFromSpec, previewBarcode } from '../barcode/barcode-form';
import { commitBarcode } from '../barcode/commit-barcode';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useCanvasDisplay } from './use-warp-deform-preview';

// Captions are drawn as one box per text, 1 mm per character plus 0.1 mm per
// unit of digit sum, so the drawn box tells which value it was drawn for.
const captions = vi.hoisted(() => ({ drawn: [] as string[] }));
vi.mock('../text/render-variable-text', () => ({
  renderVariableText: (async ({ content, text }) => {
    captions.drawn.push(content);
    const digits = [...content].reduce((sum, char) => sum + (Number(char) || 0), 0);
    const width = content.length + digits * 0.1;
    const height = text.sizeMm * 0.7;
    const points = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
      { x: 0, y: 0 },
    ];
    return {
      bounds: { minX: 0, minY: 0, maxX: width, maxY: height },
      paths: [{ color: text.color, polylines: [{ points, closed: true }] }],
    };
  }) satisfies VariableTextRenderer,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NO_SELECTION: ReadonlySet<string> = new Set();
const shown: { project: Project | null } = { project: null };
let root: Root | null = null;

function CanvasProbe(): null {
  const project = useStore((state) => state.project);
  shown.project = useCanvasDisplay(project, false, null, NO_SELECTION).project;
  return null;
}

beforeEach(() => {
  resetStore();
  captions.drawn.length = 0;
  shown.project = null;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

async function insertVariableBarcode(symbology: BarcodeSymbology): Promise<void> {
  useStore.getState().setVariableSettings({ serialValue: 1, advancement: 'manual' });
  const draft = {
    ...draftFromSpec(defaultBarcodeSpec(symbology)),
    data: 'SN-{{serial:4}}',
    variable: true,
  };
  const standIn: ShapeObject = {
    kind: 'shape',
    id: 'barcode-preview',
    spec: defaultBarcodeSpec(symbology),
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
  };
  const project = useStore.getState().project;
  const preview = previewBarcode(draft, { project, object: standIn, now: new Date() });
  if (preview.kind !== 'ready') throw new Error(preview.kind);
  expect(await commitBarcode({ spec: preview.spec, value: preview.value })).toMatchObject({
    ok: true,
  });
}

async function mountCanvas(): Promise<void> {
  const host = document.createElement('div');
  root = createRoot(host);
  await act(async () => root?.render(<CanvasProbe />));
}

/** Lets the canvas's encoding land, polling until `done` or a time limit. */
async function settle(done: () => boolean): Promise<void> {
  for (let tries = 0; tries < 100 && !done(); tries += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

function barcodeIn(project: Project | null): BarcodeObject | undefined {
  return project?.scene.objects.find(isBarcodeObject);
}

function polylinesOf(object: SceneObject | undefined): Polyline[] {
  return object !== undefined && 'paths' in object
    ? object.paths.flatMap((path) => path.polylines)
    : [];
}

function scanQr(object: BarcodeObject | undefined): string | null {
  if (object === undefined) return null;
  const { moduleMm, quietZoneModules } = object.spec;
  const size =
    Math.round((object.bounds.maxX - object.bounds.minX) / moduleMm) - 2 * quietZoneModules;
  const quiet = quietZoneModules * moduleMm;
  const grid = sampleGrid(polylinesOf(object), size, size, moduleMm, { x: quiet, y: quiet });
  const decoded = decodeQrModules(grid, size);
  return decoded.ok ? decoded.text : null;
}

function scanCode128(object: BarcodeObject | undefined): string | null {
  if (object === undefined) return null;
  const { moduleMm, quietZoneModules, barHeightMm } = object.spec;
  const modules = Math.round(object.bounds.maxX / moduleMm) - 2 * quietZoneModules;
  const barMiddle = Math.min(quietZoneModules, 2) * moduleMm + barHeightMm / 2;
  const line = sampleScanLine(
    polylinesOf(object),
    modules,
    moduleMm,
    quietZoneModules * moduleMm,
    barMiddle,
  );
  return readCode128(line);
}

/** Width of the drawn caption box: the ink below the bars. */
function captionWidth(object: BarcodeObject | undefined): number | null {
  if (object === undefined) return null;
  const barBottom = Math.min(object.spec.quietZoneModules, 2) * object.spec.moduleMm;
  const below = polylinesOf(object)
    .flatMap((polyline) => polyline.points)
    .filter((point) => point.y > barBottom + object.spec.barHeightMm + 1e-9);
  if (below.length === 0) return null;
  const xs = below.map((point) => point.x);
  return Math.round((Math.max(...xs) - Math.min(...xs)) * 1000) / 1000;
}

describe('the canvas shows a variable barcode for the current value (ADR-386 item 3)', () => {
  it('re-encodes a QR Code after the serial advances, without touching the project', async () => {
    await insertVariableBarcode('qr');
    await mountCanvas();
    expect(scanQr(barcodeIn(shown.project))).toBe('SN-0001');

    act(() => useStore.getState().advanceVariablesManually());
    const advanced = useStore.getState().project;
    await settle(() => scanQr(barcodeIn(shown.project)) === 'SN-0002');

    expect(scanQr(barcodeIn(shown.project))).toBe('SN-0002');
    // Display only: the stored code, the project and its history are unchanged.
    expect(useStore.getState().project).toBe(advanced);
    expect(scanQr(barcodeIn(advanced))).toBe('SN-0001');
    const output = await materializeVariableText(advanced, { now: new Date() }, async () => {
      throw new Error('QR Codes have no caption');
    });
    if (!output.ok) throw new Error('output failed');
    expect(scanQr(barcodeIn(output.project))).toBe('SN-0002');
  });

  it('redraws a 1D code and its human-readable text for the new value', async () => {
    await insertVariableBarcode('code128');
    await mountCanvas();
    expect(scanCode128(barcodeIn(shown.project))).toBe('SN-0001');
    expect(captionWidth(barcodeIn(shown.project))).toBe(7.1);

    act(() => useStore.getState().advanceVariablesManually());
    await settle(() => scanCode128(barcodeIn(shown.project)) === 'SN-0002');

    const displayed = barcodeIn(shown.project);
    expect(scanCode128(displayed)).toBe('SN-0002');
    expect(captions.drawn).toContain('SN-0002');
    expect(captionWidth(displayed)).toBe(7.2);
    const stored = barcodeIn(useStore.getState().project);
    expect(displayed?.transform).toEqual(stored?.transform);
    expect(displayed?.operationIds).toEqual(stored?.operationIds);
  });
});
