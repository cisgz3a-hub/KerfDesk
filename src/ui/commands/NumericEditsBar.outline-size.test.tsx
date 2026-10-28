// Rolling audit v7 L2, through the real Numeric Edits Toolbar, the Shape
// Inspector and the emitted G-code:
// - 08-P3-3 (ADR-677): a turned round shape was measured by its turned bounds
//   square, so a 50 mm circle at 45° read W 70.711 and a typed W burned 35.32.
// - L2-P2-1 (ADR-144 Amendment 1): a toolbar W/H resize stretched a rounded
//   rectangle's corners into ellipses the Corner radius box could not name.
// - L2-P3-4 / L2-P3-2: the radius survives narrowing; 0 and negatives are refused.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ShapeObject } from '../../core/scene';
import { createEllipse, createRectangle } from '../../core/shapes/primitives';
import { shapeFromDrag } from '../../core/shapes';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { SelectedObjectProperties } from '../layers/SelectedObjectProperties';
import { NumericEditsBar } from './NumericEditsBar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The G-code carries 3 decimals.
const GCODE_MM = 0.003;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  resetStore();
  useUiStore.setState({ selectionAnchor: 'nw' });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

describe('a turned round shape is measured by its outline (ADR-677)', () => {
  it('reads, resizes and places a 50 mm circle at 45° as the G-code burns it', async () => {
    const view = await renderShape(
      createEllipse({ id: 'circle', color: '#000000', spec: { widthMm: 50, heightMm: 50 } }),
    );
    await type(field(view, 'Selection rotation'), '45');
    expect(Number(field(view, 'Selection width').value)).toBeCloseTo(50, 2);
    expect(footprintNote(view)).toContain('50 × 50 mm');
    expect(burnedBox().width).toBeCloseTo(50, 1);

    await act(async () => Simulate.click(button(view, 'Lock aspect ratio')));
    await type(field(view, 'Selection width'), '40');
    expect(Math.abs(burnedBox().width - 40)).toBeLessThan(GCODE_MM + 0.01);
    expect(footprintNote(view)).toContain('40 × 40 mm');

    await type(field(view, 'Selection X position'), '100');
    expect(Math.abs(burnedBox().minX - 100)).toBeLessThan(GCODE_MM + 0.01);
  });

  it('resizes a turned rounded rectangle to the typed width', async () => {
    const view = await renderShape(
      createRectangle({
        id: 'rr',
        color: '#000000',
        spec: { widthMm: 60, heightMm: 30, cornerRadiusMm: 15 },
      }),
    );
    await type(field(view, 'Selection rotation'), '45');
    await act(async () => Simulate.click(button(view, 'Lock aspect ratio')));
    await type(field(view, 'Selection width'), '50');
    expect(Math.abs(burnedBox().width - 50)).toBeLessThan(GCODE_MM + 0.01);
  });
});

describe('a resized rounded rectangle keeps round corners (ADR-144 Amendment 1)', () => {
  it('burns the corner radius the Inspector shows after a toolbar width change', async () => {
    const view = await renderShape(
      createRectangle({
        id: 'rr',
        color: '#000000',
        spec: { widthMm: 100, heightMm: 50, cornerRadiusMm: 10 },
      }),
    );
    await type(field(view, 'Selection width'), '200');
    expect(field(view, 'Rectangle width').value).toBe('200');
    expect(field(view, 'Rectangle corner radius').value).toBe('10');
    expect(selectedShape().transform).toMatchObject({ scaleX: 1, scaleY: 1 });
    expect(burnedCorner()).toEqual({ alongX: 10, alongY: 10 });

    await editInspector(view, 'Rectangle corner radius', '6');
    expect(burnedCorner()).toEqual({ alongX: 6, alongY: 6 });
    expect(burnedBox().width).toBeCloseTo(200, 3);
  });

  it('keeps a drag-drawn rectangle round through W, H and a typed radius', async () => {
    const drawn = shapeFromDrag({
      kind: 'rect',
      id: 'dragged',
      color: '#000000',
      start: { x: 10, y: 10 },
      end: { x: 50, y: 30 },
    });
    const view = await renderShape(drawn);
    await type(field(view, 'Selection width'), '200');
    await type(field(view, 'Selection height'), '50');
    await editInspector(view, 'Rectangle corner radius', '5');
    expect(burnedCorner()).toEqual({ alongX: 5, alongY: 5 });
    expect(selectedShape().spec).toMatchObject({ widthMm: 200, heightMm: 50, cornerRadiusMm: 5 });
  });

  it('brings the radius back when a narrowed rectangle is widened again', async () => {
    const view = await renderShape(
      createRectangle({
        id: 'rr',
        color: '#000000',
        spec: { widthMm: 50, heightMm: 50, cornerRadiusMm: 20 },
      }),
    );
    await editInspector(view, 'Rectangle width', '10');
    expect(field(view, 'Rectangle corner radius').value).toBe('5');
    await editInspector(view, 'Rectangle width', '50');
    expect(field(view, 'Rectangle corner radius').value).toBe('20');
    expect(burnedCorner()).toEqual({ alongX: 20, alongY: 20 });
  });

  it('names and rounds the corners of a rectangle an older build stretched', async () => {
    const rectangle = createRectangle({
      id: 'legacy',
      color: '#000000',
      spec: { widthMm: 100, heightMm: 50, cornerRadiusMm: 10 },
    });
    const view = await renderShape({
      ...rectangle,
      transform: { ...rectangle.transform, scaleX: 2 },
    });
    expect(view.textContent).toContain('The corners are stretched to 20 × 10 mm');
    await editInspector(view, 'Rectangle corner radius', '6');
    expect(selectedShape().transform).toMatchObject({ scaleX: 1, scaleY: 1 });
    expect(selectedShape().spec).toMatchObject({ widthMm: 200, heightMm: 50, cornerRadiusMm: 6 });
    expect(burnedCorner()).toEqual({ alongX: 6, alongY: 6 });
    expect(view.textContent).not.toContain('stretched');
  });

  it('refuses a width of 0 or less instead of collapsing the shape', async () => {
    const view = await renderShape(
      createRectangle({
        id: 'rr',
        color: '#000000',
        spec: { widthMm: 40, heightMm: 20, cornerRadiusMm: 0 },
      }),
    );
    const undoDepth = useStore.getState().undoStack.length;
    for (const entry of ['0', '-5', '1e-400']) {
      await editInspector(view, 'Rectangle width', entry);
      expect(field(view, 'Rectangle width').getAttribute('aria-invalid')).toBe('true');
      expect(selectedShape().spec).toMatchObject({ widthMm: 40 });
    }
    expect(useStore.getState().undoStack).toHaveLength(undoDepth);
    await editInspector(view, 'Rectangle width', '0.001');
    expect(selectedShape().spec).toMatchObject({ widthMm: 0.01 });
  });
});

async function renderShape(shape: ShapeObject): Promise<HTMLDivElement> {
  useStore.getState().drawShape(shape);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <>
        <NumericEditsBar />
        <SelectedObjectProperties />
      </>,
    ),
  );
  return host;
}

function field(container: HTMLElement, label: string): HTMLInputElement {
  const found = container.querySelector(`input[aria-label="${label}"]`);
  if (!(found instanceof HTMLInputElement)) throw new Error(`${label} input missing`);
  return found;
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = container.querySelector(`button[aria-label="${label}"]`);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`${label} button missing`);
  return found;
}

function footprintNote(container: HTMLElement): string {
  const notes = [...container.querySelectorAll('[role="note"]')].map((note) => note.textContent);
  return notes.find((text) => text?.includes('footprint')) ?? '';
}

// The toolbar commits on Enter.
async function type(element: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new InputEvent('input', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

// The Inspector commits on blur.
async function editInspector(container: HTMLElement, label: string, value: string): Promise<void> {
  const input = field(container, label);
  await act(async () => {
    input.value = value;
    Simulate.change(input);
  });
  await act(async () => Simulate.blur(input));
}

function selectedShape(): ShapeObject {
  const selected = useStore.getState().project.scene.objects[0];
  if (selected?.kind !== 'shape') throw new Error('selected shape missing');
  return selected;
}

type Point = { readonly x: number; readonly y: number };

function burnedPoints(): ReadonlyArray<Point> {
  const { gcode } = emitGcode(useStore.getState().project);
  const points: Point[] = [];
  let at: Point | null = null;
  for (const line of gcode.split('\n')) {
    const move = /^G([01])\b/.exec(line.trim());
    if (move === null) continue;
    const next: Point = { x: word(line, 'X') ?? at?.x ?? 0, y: word(line, 'Y') ?? at?.y ?? 0 };
    if (move[1] === '1' && at !== null) points.push(at, next);
    at = next;
  }
  if (points.length === 0) throw new Error('no burned moves in the G-code');
  return points;
}

function word(line: string, letter: 'X' | 'Y'): number | undefined {
  const value = new RegExp(`${letter}(-?[\\d.]+)`).exec(line)?.[1];
  return value === undefined ? undefined : Number(value);
}

function burnedBox(): { width: number; height: number; minX: number; minY: number } {
  const points = burnedPoints();
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { width: Math.max(...xs) - minX, height: Math.max(...ys) - minY, minX, minY };
}

// How far the rounded corner reaches along each edge of an upright rectangle:
// the straight edges start that far in from the corner of the box.
function burnedCorner(): { alongX: number; alongY: number } {
  const points = burnedPoints();
  const box = burnedBox();
  const onBottom = points.filter((point) => Math.abs(point.y - box.minY) < GCODE_MM);
  const onLeft = points.filter((point) => Math.abs(point.x - box.minX) < GCODE_MM);
  const alongX = Math.min(...onBottom.map((point) => point.x)) - box.minX;
  const alongY = Math.min(...onLeft.map((point) => point.y)) - box.minY;
  return { alongX: Number(alongX.toFixed(2)), alongY: Number(alongY.toFixed(2)) };
}
