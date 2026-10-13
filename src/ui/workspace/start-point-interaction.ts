import { useRef, useState } from 'react';
import type { Project, Vec2 } from '../../core/scene';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { useStore } from '../state/store';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import {
  selectCanvasStart,
  type StartEditingContext,
  type StartKind,
  type StartSelection,
} from './canvas-start-editing';
import { computeView, type ViewState } from './view-transform';

export function startEditingBusy(): boolean {
  const laser = useLaserStore.getState();
  return (
    useFramePreparationStore.getState().pending ||
    isActiveJob(laser.streamer) ||
    laser.motionOperation !== null ||
    laser.controllerOperation !== null ||
    laser.framedRunStartClaim !== null
  );
}

type Drag = {
  readonly pointerId: number;
  readonly kind: StartKind;
  readonly from: Vec2;
  readonly anchor: Vec2;
  readonly project: Project;
  readonly plan: CanvasMotionPlan;
  readonly epoch: number;
  selection: StartSelection | null;
};
export type StartInteractionInput = {
  readonly canvas: React.RefObject<HTMLCanvasElement | null>;
  readonly project: Project;
  readonly view: ViewState;
  readonly plan: CanvasMotionPlan;
  readonly context: StartEditingContext | undefined;
};

export function useStartPointInteraction(input: StartInteractionInput) {
  const drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<{ kind: StartKind; point: Vec2 } | null>(null);
  const cancel = (): void => {
    drag.current = null;
    setDraft(null);
  };
  const valid = (): boolean =>
    input.context?.sourceProject === useStore.getState().project && !startEditingBusy();
  const down = (
    kind: StartKind,
    anchor: Vec2,
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    if (event.button !== 0 || !valid()) return;
    const from = pointerScene(event, input);
    if (from === null) return;
    event.currentTarget.focus({ preventScroll: true });
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = beginDrag(event.pointerId, kind, from, anchor, input.project, input.plan);
  };
  const move = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const active = drag.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    if (
      !valid() ||
      active.project !== input.project ||
      active.plan !== input.plan ||
      active.epoch !== useStore.getState().projectDocumentEpoch
    ) {
      cancel();
      return;
    }
    const pointer = pointerScene(event, input);
    if (pointer === null || input.context === undefined) return;
    const target = {
      x: active.anchor.x + pointer.x - active.from.x,
      y: active.anchor.y + pointer.y - active.from.y,
    };
    active.selection = selectCanvasStart(active.kind, target, input.plan, input.context);
    if (active.selection !== null) setDraft({ kind: active.kind, point: active.selection.point });
  };
  const up = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    if (
      valid() &&
      active.project === input.project &&
      active.plan === input.plan &&
      active.epoch === useStore.getState().projectDocumentEpoch &&
      active.selection !== null
    ) {
      useStore.getState().setProjectStartPoints(active.selection.settings);
    }
    cancel();
  };
  const key = (
    kind: StartKind,
    anchor: Vec2,
    event: React.KeyboardEvent<HTMLButtonElement>,
    disabled = false,
  ): void => {
    if (startKeyAllowsEdit(event, cancel) && !disabled && valid())
      moveWithKeyboard(kind, anchor, event, input);
  };
  return {
    draft: drag.current?.project === input.project ? draft : null,
    down,
    move,
    up,
    cancel,
    key,
  };
}

function startKeyAllowsEdit(
  event: React.KeyboardEvent<HTMLButtonElement>,
  cancel: () => void,
): boolean {
  if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
    event.stopPropagation();
    return false;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    cancel();
    return false;
  }
  if (arrowDelta(event.key, 1) === null) return false;
  // Focusable unavailable handles must not hand arrow keys to artwork nudging.
  event.preventDefault();
  event.stopPropagation();
  return true;
}

function moveWithKeyboard(
  kind: StartKind,
  anchor: Vec2,
  event: React.KeyboardEvent<HTMLButtonElement>,
  input: StartInteractionInput,
): void {
  const delta = arrowDelta(event.key, event.shiftKey ? 10 : 1);
  if (delta === null || input.context === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  const selected = selectCanvasStart(
    kind,
    { x: anchor.x + delta.x, y: anchor.y + delta.y },
    input.plan,
    input.context,
  );
  if (selected !== null) useStore.getState().setProjectStartPoints(selected.settings);
}

function beginDrag(
  pointerId: number,
  kind: StartKind,
  from: Vec2,
  anchor: Vec2,
  project: Project,
  plan: CanvasMotionPlan,
): Drag {
  return {
    pointerId,
    kind,
    from,
    anchor,
    project,
    plan,
    epoch: useStore.getState().projectDocumentEpoch,
    selection: null,
  };
}

function pointerScene(
  event: { clientX: number; clientY: number },
  input: StartInteractionInput,
): Vec2 | null {
  const canvas = input.canvas.current;
  if (canvas === null) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const view = computeView(
    canvas.width,
    canvas.height,
    input.project.device.bedWidth,
    input.project.device.bedHeight,
    input.view,
  );
  return {
    x: (((event.clientX - rect.left) * canvas.width) / rect.width - view.offsetX) / view.scale,
    y: (((event.clientY - rect.top) * canvas.height) / rect.height - view.offsetY) / view.scale,
  };
}

function arrowDelta(key: string, step: number): Vec2 | null {
  switch (key) {
    case 'ArrowLeft':
      return { x: -step, y: 0 };
    case 'ArrowRight':
      return { x: step, y: 0 };
    case 'ArrowUp':
      return { x: 0, y: -step };
    case 'ArrowDown':
      return { x: 0, y: step };
    default:
      return null;
  }
}
