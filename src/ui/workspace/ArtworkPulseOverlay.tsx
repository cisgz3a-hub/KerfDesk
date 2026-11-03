// The operation colour pulse (ADR-620). Artwork rests in plain ink. When the
// pointer settles on a piece (select tool) or on an operation row, every piece
// sharing those settings pulses once in that operation's colour, rippling
// outward, and keeps a soft colour edge while the pointer stays. Editing a
// piece's settings lights up the artwork the edit changes, the same way, and
// each change pulses it again (ADR-646). Drawn on its own pointer-transparent
// canvas, so a pulse never redraws the scene.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  machineKindOf,
  transformedBBox,
  type Project,
  type Scene,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { workspaceHitTest } from './workspace-hit-test';
import { usePrefersReducedMotion } from '../common/use-prefers-reduced-motion';
import { useStore } from '../state';
import type { EditedArtwork } from '../state/artwork-color-hint';
import { useUiStore } from '../state/ui-store';
import { useCanvasColorScheme } from '../theme/use-canvas-color-scheme';
import {
  ArtworkPulseClock,
  PULSE_HOVER_DWELL_MS,
  PulseTrigger,
  pulseSeedKey,
  pulseTargetFor,
  type PulseSeed,
} from './artwork-pulse';
import { ArtworkPulsePainter } from './draw-artwork-pulse';
import type { ObjectDisplayMode } from './object-display';
import type { CanvasBitmapSize } from './use-canvas-bitmap-size';
import { computeView, type ViewState, type ViewTransform } from './view-transform';

/** Past the hovered piece's box by this much, the hover ends without waiting to settle. */
const LEAVE_TOLERANCE_MM = 2;
const LEAVE_TOLERANCE_PX = 6;

export function ArtworkPulseOverlay(props: {
  readonly canvasRef: React.RefObject<HTMLCanvasElement | null>;
  readonly project: Project;
  readonly canvasSize: CanvasBitmapSize;
  readonly viewState: ViewState;
  /** Pointing at artwork counts only for the select tool at rest; operation rows always count. */
  readonly canvasHoverEnabled: boolean;
  /** Only a pointer gesture may retain its hover until the pointer reports again. */
  readonly canvasHoverPaused?: boolean;
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const { width, height } = props.canvasSize;
  const { bedWidth, bedHeight } = props.project.device;
  const view = useMemo(
    () => computeView(width, height, bedWidth, bedHeight, props.viewState),
    [width, height, bedWidth, bedHeight, props.viewState],
  );
  const cursor = useStore((state) => state.cursorMm);
  const rowOperationId = useUiStore((state) => state.hoveredOperationId);
  const edited = useUiStore((state) => state.editedArtwork);
  const hoveredObjectId = useCanvasHoverObject(
    props.canvasRef,
    cursor,
    props.project.scene,
    view.scale,
    props.canvasHoverEnabled,
    props.canvasHoverPaused ?? false,
  );
  // Pointing at something is the more deliberate act, so a hover wins over
  // an edit in progress; the edit's glow returns when the hover ends.
  const seed: PulseSeed | null =
    rowOperationId !== null
      ? { kind: 'operation', operationId: rowOperationId }
      : hoveredObjectId !== null && props.canvasHoverEnabled
        ? { kind: 'object', objectId: hoveredObjectId }
        : edited !== null
          ? { kind: 'edit', ...edited, serial: editSerial(edited) }
          : null;
  usePulseLoop(ref, props.project, view, seed, hoveredObjectId, props.canvasHoverPaused ?? false);
  // Holding Alt shows every operation in its own colour on the canvas below;
  // a group pulsing in one shared colour would paint over exactly that.
  const peek = useUiStore((state) => state.operationColorPeek);
  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={peek ? hiddenLayerStyle : layerStyle}
      aria-hidden="true"
      data-testid="artwork-pulse-layer"
    />
  );
}

// The store keeps an edit's object while the same edit is set again, and makes
// a new one for each edit that begins: its identity numbers the edit, even
// while a hover hides it.
const editSerials = new WeakMap<EditedArtwork, number>();
let lastEditSerial = 0;

function editSerial(edit: EditedArtwork): number {
  let serial = editSerials.get(edit);
  if (serial === undefined) {
    lastEditSerial += 1;
    serial = lastEditSerial;
    editSerials.set(edit, serial);
  }
  return serial;
}

/** The artwork under a settled pointer; cleared as soon as the pointer leaves it. */
function useCanvasHoverObject(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  cursor: Vec2 | null,
  scene: Scene,
  scale: number,
  enabled: boolean,
  pauseHover: boolean,
): string | null {
  const [hovered, setHovered] = useState<string | null>(null);
  // Set while a click or drag owns the pointer, until the pointer reports again.
  const paused = useRef(false);
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    // Cursor null also means an ordinary click finished. Physical leave and
    // cancellation must independently end a paused hover, even if cursor null
    // has already been reported by pointer-up.
    const leave = (): void => {
      if (dwellTimer.current !== null) clearTimeout(dwellTimer.current);
      dwellTimer.current = null;
      paused.current = false;
      setHovered(null);
    };
    return listenForHoverBoundary(canvas, leave);
  }, [canvasRef]);
  const x = cursor?.x ?? null;
  const y = cursor?.y ?? null;
  useEffect(() => {
    // Only a click or drag keeps its hover. Another tool ends it outright.
    if (!enabled) {
      paused.current = pauseHover;
      if (!pauseHover) setHovered(null);
      return;
    }
    if (x === null || y === null) {
      // Pointer-up clears the cursor although the pointer has not moved, so
      // a paused hover holds until the pointer reports where it is.
      if (!paused.current) setHovered(null);
      return;
    }
    paused.current = false;
    const point = { x, y };
    const tolerance = LEAVE_TOLERANCE_MM + LEAVE_TOLERANCE_PX / scale;
    setHovered((current) =>
      current !== null && !pointNearObject(scene, current, point, tolerance) ? null : current,
    );
    // Hit-testing a dense trace flattens its curves, so it waits for the
    // pointer to settle rather than running on every move.
    // Locked artwork still shows its settings, and must not let the piece
    // beneath it answer for it.
    dwellTimer.current = setTimeout(
      () => setHovered(workspaceHitTest(scene, point, { includeLocked: true })),
      PULSE_HOVER_DWELL_MS,
    );
    return () => {
      if (dwellTimer.current !== null) clearTimeout(dwellTimer.current);
      dwellTimer.current = null;
    };
  }, [x, y, scene, scale, enabled, pauseHover]);
  return hovered;
}

/** Capture release follows ordinary pointer-up as well as cancellation. */
function listenForHoverBoundary(canvas: HTMLCanvasElement, leave: () => void): () => void {
  const releasedPointers = new Set<number>();
  const begin = (event: PointerEvent): void => {
    releasedPointers.delete(event.pointerId);
  };
  const release = (event: PointerEvent): void => {
    // Capture is implicitly released after pointer-up dispatch. Uncaptured
    // clicks have no subsequent capture-loss event and need no marker.
    if (canvas.hasPointerCapture?.(event.pointerId)) releasedPointers.add(event.pointerId);
    const bounds = canvas.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX >= bounds.right ||
      event.clientY < bounds.top ||
      event.clientY >= bounds.bottom
    )
      leave();
  };
  const lostCapture = (event: PointerEvent): void => {
    // Only an unexpected loss ends the hover; a normal click resumes it.
    if (!releasedPointers.delete(event.pointerId)) leave();
  };
  const cancel = (event: PointerEvent): void => {
    releasedPointers.delete(event.pointerId);
    leave();
  };
  const listeners = [
    ['pointerdown', begin],
    ['pointerleave', leave],
    ['pointercancel', cancel],
    ['pointerup', release],
    ['lostpointercapture', lostCapture],
  ] as const;
  for (const [type, handler] of listeners) canvas.addEventListener(type, handler);
  return () => {
    for (const [type, handler] of listeners) canvas.removeEventListener(type, handler);
  };
}

function pointNearObject(scene: Scene, id: string, point: Vec2, toleranceMm: number): boolean {
  const object = scene.objects.find((candidate) => candidate.id === id);
  if (object === undefined) return false;
  const box = transformedBBox(object);
  return (
    point.x >= box.minX - toleranceMm &&
    point.x <= box.maxX + toleranceMm &&
    point.y >= box.minY - toleranceMm &&
    point.y <= box.maxY + toleranceMm
  );
}

function usePulseLoop(
  ref: React.RefObject<HTMLCanvasElement | null>,
  project: Project,
  view: ViewTransform,
  seed: PulseSeed | null,
  canvasObjectId: string | null,
  held: boolean,
): void {
  const reducedMotion = usePrefersReducedMotion();
  const colorScheme = useCanvasColorScheme();
  const wireframe = useUiStore((state) => state.wireframeView);
  const displayMode = wireframe ? 'wireframe' : 'design';
  const [trigger] = useState(() => new PulseTrigger());
  const latest = useRef<PulseLoopState>({ project, view, reducedMotion, displayMode, held });
  latest.current = { project, view, reducedMotion, displayMode, held };
  const [loop] = useState(() =>
    createPulseLoop(() => ({
      ctx: ref.current?.getContext('2d') ?? null,
      state: latest.current,
    })),
  );
  const seedKey = pulseSeedKey(seed);
  const scene = project.scene;
  const machineKind = machineKindOf(project.machine);
  useEffect(() => {
    const pulse = trigger.next(seed, canvasObjectId, scene);
    const target =
      seed === null
        ? null
        : pulseTargetFor(project.scene.objects, project.scene.layers, machineKind, seed, (object) =>
            screenCenter(object, view),
          );
    if (target === null) loop.clock.leave();
    else loop.clock.hover(target, performance.now(), { pulse });
    loop.kick();
    // Keyed on the hover, scene and machine kind: a view change repaints through
    // the effect below and must not regroup or restart anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey, scene, machineKind, canvasObjectId]);
  useEffect(() => {
    loop.kick();
  }, [project, view, reducedMotion, colorScheme, displayMode, loop]);
  useEffect(() => () => loop.dispose(), [loop]);
}

type PulseLoopState = {
  readonly project: Project;
  readonly view: ViewTransform;
  readonly reducedMotion: boolean;
  readonly displayMode: ObjectDisplayMode;
  /** A drag owns the pointer: artwork it moves rests the glow (ADR-620 Amendment 1). */
  readonly held: boolean;
};

/**
 * Runs animation frames only while a pulse or an edge fade is in flight, or
 * while the painter still has bitmaps to render or a moved view to settle.
 */
function createPulseLoop(
  read: () => { readonly ctx: CanvasRenderingContext2D | null; readonly state: PulseLoopState },
) {
  const clock = new ArtworkPulseClock();
  const painter = new ArtworkPulsePainter();
  let frameId: number | null = null;
  function tick(now: number): void {
    frameId = null;
    const { ctx, state } = read();
    if (ctx === null) return;
    const frame = clock.frame(now, state.reducedMotion);
    const { project, view, displayMode, held } = state;
    const pending = painter.draw(ctx, project, view, frame.pieces, displayMode, now, held);
    if (frame.busy || pending) kick();
  }
  function kick(): void {
    if (frameId === null) frameId = requestAnimationFrame(tick);
  }
  function dispose(): void {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
  }
  return { clock, kick, dispose };
}

function screenCenter(
  object: SceneObject,
  view: ViewTransform,
): { readonly x: number; readonly y: number } {
  const box = transformedBBox(object);
  return {
    x: view.offsetX + ((box.minX + box.maxX) / 2) * view.scale,
    y: view.offsetY + ((box.minY + box.maxY) / 2) * view.scale,
  };
}

const layerStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
};
const hiddenLayerStyle: React.CSSProperties = { ...layerStyle, visibility: 'hidden' };
