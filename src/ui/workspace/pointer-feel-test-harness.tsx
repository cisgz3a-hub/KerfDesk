// A canvas driven through the real pointer pipeline, for the pointer-feel
// tests (ADR-196 Amendment 1). Presses are given as a scene point plus an
// offset in screen pixels, since the rules under test are pixel rules.

import { act, useCallback, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { resetStore } from '../state/test-helpers';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import { DEFAULT_SNAP_SETTINGS } from './snap-settings';
import { useDragMove } from './use-workspace-drag';
import { computeView, type ViewState } from './view-transform';

export const CANVAS_PX = 1000;
export const BED_MM = 400;
const POINTER_ID = 11;
// Scene data (an object's stroke), not UI chrome: exempt from the token rule (ADR-047).
// eslint-disable-next-line no-restricted-syntax
const COLOR = '#000000';
const roots: Root[] = [];
let view: ViewState = { zoomFactor: 1, panX: 0, panY: 0 };

type PointerType = 'mouse' | 'pen' | 'touch';

export type PointerInit = {
  readonly button?: number;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  /** Screen pixels added to the scene point's position. */
  readonly dxPx?: number;
  readonly dyPx?: number;
  readonly pointerType?: PointerType;
};

export function resetPointerHarness(snapping: boolean): void {
  resetStore();
  view = { zoomFactor: 1, panX: 0, panY: 0 };
  useUiStore.setState({
    draftShape: null,
    measureDraft: null,
    selectionMarquee: null,
    snapGuides: [],
    snapMarker: null,
    snapSettings: { ...DEFAULT_SNAP_SETTINGS, enabled: snapping },
    spaceDown: false,
    toolMode: { kind: 'select' },
    workspaceContextBar: null,
    wireframeView: false,
    zoomFactor: 1,
    panX: 0,
    panY: 0,
    artworkNumbering: { kind: 'idle' },
  });
  useStore.getState().setProject(projectWith());
}

export async function cleanupPointerHarness(): Promise<void> {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = '';
}

function Harness(props: { readonly view: ViewState }): JSX.Element {
  const project = useStore((state) => state.project);
  const ref = useRef<HTMLCanvasElement | null>(null);
  const setRef = useCallback((node: HTMLCanvasElement | null) => {
    ref.current = node;
    if (node === null) return;
    node.getBoundingClientRect = () =>
      ({
        ...{ x: 0, y: 0, left: 0, top: 0, right: CANVAS_PX, bottom: CANVAS_PX },
        ...{ width: CANVAS_PX, height: CANVAS_PX, toJSON: () => ({}) },
      }) as DOMRect;
    node.setPointerCapture = vi.fn();
    node.releasePointerCapture = vi.fn();
    node.hasPointerCapture = () => false;
  }, []);
  const { handlers, dragKind } = useDragMove(ref, project, false, props.view);
  return (
    <canvas
      ref={setRef}
      width={CANVAS_PX}
      height={CANVAS_PX}
      data-drag-kind={dragKind ?? ''}
      {...handlers}
    />
  );
}

export async function renderPointerHarness(
  zoomFactor = 1,
  pan: { readonly panX: number; readonly panY: number } = { panX: 0, panY: 0 },
): Promise<HTMLCanvasElement> {
  view = { zoomFactor, ...pan };
  useUiStore.setState(view);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<Harness view={view} />));
  const canvas = host.querySelector('canvas');
  if (canvas === null) throw new Error('pointer harness canvas missing');
  return canvas;
}

/** Scene millimetres per screen pixel in the mounted harness. */
export function harnessPxToMm(): number {
  return 1 / harnessView().scale;
}

function harnessView(): ReturnType<typeof computeView> {
  const device = useStore.getState().project.device;
  return computeView(CANVAS_PX, CANVAS_PX, device.bedWidth, device.bedHeight, view);
}

export async function pointer(
  canvas: HTMLCanvasElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  scenePoint: Vec2,
  init: PointerInit = {},
): Promise<void> {
  const v = harnessView();
  const event = new MouseEvent(type, {
    bubbles: true,
    button: init.button ?? 0,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
    clientX: v.offsetX + scenePoint.x * v.scale + (init.dxPx ?? 0),
    clientY: v.offsetY + scenePoint.y * v.scale + (init.dyPx ?? 0),
  });
  Object.defineProperty(event, 'pointerId', { value: POINTER_ID });
  Object.defineProperty(event, 'pointerType', { value: init.pointerType ?? 'mouse' });
  await act(async () => {
    canvas.dispatchEvent(event);
  });
}

/** Press, optionally travel by screen pixels, and release. */
export async function pressAndRelease(
  canvas: HTMLCanvasElement,
  scenePoint: Vec2,
  init: PointerInit & { readonly travelPx?: Vec2 } = {},
): Promise<void> {
  const { travelPx, ...rest } = init;
  await pointer(canvas, 'pointerdown', scenePoint, rest);
  const moved =
    travelPx === undefined
      ? rest
      : { ...rest, dxPx: (rest.dxPx ?? 0) + travelPx.x, dyPx: (rest.dyPx ?? 0) + travelPx.y };
  if (travelPx !== undefined) await pointer(canvas, 'pointermove', scenePoint, moved);
  await pointer(canvas, 'pointerup', scenePoint, moved);
}

export async function pressEscape(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

/** An unfilled (Line) rectangle whose top-left corner sits at (x, y). */
export function outline(id: string, x: number, y: number, sizeMm: number): SceneObject {
  return createRectangle({
    id,
    color: COLOR,
    spec: { widthMm: sizeMm, heightMm: sizeMm, cornerRadiusMm: 0 },
    transform: { ...IDENTITY_TRANSFORM, x, y },
  });
}

/** A straight horizontal line from (x, y), `lengthMm` long. */
export function straightLine(id: string, x: number, y: number, lengthMm: number): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: lengthMm, maxY: 0 },
    transform: { ...IDENTITY_TRANSFORM, x, y },
    paths: [
      {
        color: COLOR,
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: lengthMm, y: 0 },
            ],
          },
        ],
      },
    ],
  };
}

export function projectWith(...objects: SceneObject[]): Project {
  const base = createProject();
  return {
    ...base,
    // A known bed, so the tests can name the middle of the view.
    device: { ...base.device, bedWidth: BED_MM, bedHeight: BED_MM },
    scene: {
      objects,
      layers: [createLayer({ id: COLOR, color: COLOR })],
      groups: [],
    },
  };
}

export function loadProject(...objects: SceneObject[]): Project {
  const project = projectWith(...objects);
  useStore.getState().setProject(project);
  return useStore.getState().project;
}

export function objectById(id: string): SceneObject {
  const object = useStore.getState().project.scene.objects.find((item) => item.id === id);
  if (object === undefined) throw new Error(`object ${id} missing`);
  return object;
}

export function selectedIds(): ReadonlyArray<string> {
  const state = useStore.getState();
  return [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...[...state.additionalSelectedIds].filter((id) => id !== state.selectedObjectId),
  ].sort();
}
