// Rolling audit v8 N3-P1-1 (ADR-494 Amendment 3), through the real Numeric
// Edits Toolbar, Shape Properties and the emitted G-code. A resized rounded
// rectangle is rebuilt at its new size so its corners stay round (ADR-144
// Amendment 1). The rebuilt outline starts elsewhere and shares its length
// between edges and corners differently, so tabs placed by hand, kept as
// fractions of the outline, burned 21.3 and 21.7 mm from where the stretch put
// them, one on a corner arc. They now burn where the stretch puts them.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { burnedTabSpans } from '../../__fixtures__/burned-tab-spans';
import { cncTabAnchorPosition, projectCncTabAnchor } from '../../core/cnc/cnc-tab-anchors';
import { toMachineCoords } from '../../core/devices';
import {
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type ShapeObject,
  type Vec2,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { SelectedObjectProperties } from '../layers/SelectedObjectProperties';
import { NumericEditsBar } from './NumericEditsBar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const COLOR = '#000000';
// The G-code carries 3 decimals.
const GCODE_MM = 0.003;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  resetStore();
  useUiStore.setState({ selectionAnchor: 'nw' });
  useToastStore.setState({ toasts: [] });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

describe('tabs placed by hand follow a resized rectangle (ADR-494 Amendment 3)', () => {
  it('burns them where the stretch puts them after a toolbar width change', async () => {
    // 100 × 50 r 10 at (100, 100), tabs at the middle of the right edge and of
    // the far long edge: the audit's part.
    const view = await renderPart(10);
    expectBurnedTabsAt([p(200, 125), p(150, 150)]);

    await type(field(view, 'Selection width'), '200');

    expect(part().spec).toMatchObject({ widthMm: 200, heightMm: 50, cornerRadiusMm: 10 });
    expect(part().transform).toMatchObject({ scaleX: 1, scaleY: 1 });
    // Before the fix: (297.916, 253.889) on the corner arc and (178.289, 250)
    // in machine coordinates, 21.3 and 21.7 mm from these.
    expectBurnedTabsAt([p(300, 125), p(200, 150)]);
    expectCncTabsAt([p(300, 125), p(200, 150)]);
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('burns them where the stretch puts them after a locked 2× resize', async () => {
    const view = await renderPart(10);
    await act(async () => Simulate.click(button(view, 'Lock aspect ratio')));

    await type(field(view, 'Selection width'), '200');

    expect(part().spec).toMatchObject({ widthMm: 200, heightMm: 100, cornerRadiusMm: 10 });
    // Before the fix both moved 7.57 mm.
    expectBurnedTabsAt([p(300, 150), p(200, 200)]);
    expectCncTabsAt([p(300, 150), p(200, 200)]);
  });

  it('burns them where the stretch puts them after a Shape Properties width', async () => {
    for (const radius of [10, 0]) {
      const view = await renderPart(radius);

      await editInspector(view, 'Rectangle width', '200');

      expect(part().spec).toMatchObject({ widthMm: 200, heightMm: 50, cornerRadiusMm: radius });
      // Before the fix: 21.3 / 21.7 mm with round corners, 16.7 mm with sharp ones.
      expectBurnedTabsAt([p(300, 125), p(200, 150)]);
      expectCncTabsAt([p(300, 125), p(200, 150)]);
      expect(useToastStore.getState().toasts).toEqual([]);
      await act(async () => root?.unmount());
      root = null;
    }
  });

  it('keeps a tab on its straight edge when Shape Properties changes the corner radius', async () => {
    const view = await renderPart(10);

    await editInspector(view, 'Rectangle corner radius', '20');

    // The corners grew but neither tab sat on them; before the fix the
    // shorter outline carried both round towards its start.
    expectBurnedTabsAt([p(200, 125), p(150, 150)]);
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});

async function renderPart(radius: number): Promise<HTMLDivElement> {
  const rectangle = createRectangle({
    id: 'rr',
    color: COLOR,
    spec: { widthMm: 100, heightMm: 50, cornerRadiusMm: radius },
    transform: { ...IDENTITY_TRANSFORM, x: 100, y: 100 },
  });
  const anchors = [p(200, 125), p(150, 150)].map((point) => {
    const anchor = projectCncTabAnchor(rectangle, COLOR, point);
    if (anchor === null) throw new Error('the tab is not on the outline');
    return anchor;
  });
  const object: ShapeObject = {
    ...rectangle,
    operationIds: ['cut'],
    laserTabAnchors: anchors,
    cncTabAnchors: anchors,
  };
  const layer = {
    ...createLayer({ id: 'cut', name: 'cut', color: COLOR }),
    mode: 'line' as const,
    power: 50,
    tabsEnabled: true,
    tabSizeMm: 2,
    tabsPerShape: 4,
    tabCutPowerPercent: 20,
  };
  useStore.setState({
    project: { ...createProject(), scene: { objects: [object], layers: [layer], groups: [] } },
    selectedObjectId: object.id,
    additionalSelectedIds: new Set(),
    dirty: false,
  });
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

function p(x: number, y: number): Vec2 {
  return { x, y };
}

function part(): ShapeObject {
  const object = useStore.getState().project.scene.objects[0];
  if (object?.kind !== 'shape') throw new Error('the part is gone');
  return object;
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

// The toolbar commits on Enter.
async function type(element: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new InputEvent('input', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

// Shape Properties commits on blur.
async function editInspector(container: HTMLElement, label: string, value: string): Promise<void> {
  const input = field(container, label);
  await act(async () => {
    input.value = value;
    Simulate.change(input);
  });
  await act(async () => Simulate.blur(input));
}

// Every burned tab span's midpoint is one of `scenePoints`, each matched once.
function expectBurnedTabsAt(scenePoints: ReadonlyArray<Vec2>): void {
  const { project } = useStore.getState();
  const device = project.device;
  const spans = burnedTabSpans(project);
  expect(spans).toHaveLength(scenePoints.length);
  for (const point of scenePoints) {
    const want = toMachineCoords(point, device);
    const nearest = Math.min(...spans.map((span) => Math.hypot(span.x - want.x, span.y - want.y)));
    expect(nearest).toBeLessThan(GCODE_MM);
  }
}

// Where the CNC tabs placed by hand resolve, in order.
function expectCncTabsAt(scenePoints: ReadonlyArray<Vec2>): void {
  const object = part();
  const placed = (object.cncTabAnchors ?? []).map((anchor) => cncTabAnchorPosition(object, anchor));
  expect(placed).toHaveLength(scenePoints.length);
  scenePoints.forEach((point, index) => {
    const at = placed[index];
    if (at === null || at === undefined) throw new Error(`CNC tab ${index} is not on its contour`);
    expect(Math.hypot(at.x - point.x, at.y - point.y)).toBeLessThan(1e-6);
  });
}
