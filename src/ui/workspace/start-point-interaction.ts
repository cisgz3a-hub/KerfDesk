import { useEffect, useRef, useState } from 'react';
import type { Project, Vec2 } from '../../core/scene';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { useStore } from '../state/store';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import {
  selectCanvasStart,
  startEditReason,
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
  readonly screenFrom: Vec2;
  readonly anchor: Vec2;
  readonly project: Project;
  readonly plan: CanvasMotionPlan;
  readonly epoch: number;
  selection: StartSelection | null;
};
type KeyboardSelection = {
  // Only this hook's own commits can reuse immutable geometry while a replacement plan is pending.
  readonly kind: StartKind;
  readonly point: Vec2;
  readonly project: Project;
  readonly inputProject: Project;
  readonly plan: CanvasMotionPlan;
  readonly context: StartEditingContext;
  readonly environment: ReadonlyArray<unknown>;
};
export type StartInteractionInput = {
  readonly canvas: React.RefObject<HTMLCanvasElement | null>;
  readonly project: Project;
  readonly view: ViewState;
  readonly plan: CanvasMotionPlan;
  readonly context: StartEditingContext | undefined;
};
type InteractionState = {
  readonly drag: { current: Drag | null };
  readonly keyboard: { current: KeyboardSelection | null };
  readonly setDraft: (draft: { kind: StartKind; point: Vec2 } | null) => void;
  readonly cancel: () => void;
};

export function useStartPointInteraction(input: StartInteractionInput) {
  const drag = useRef<Drag | null>(null);
  const keyboard = useRef<KeyboardSelection | null>(null);
  useEffect(() => {
    const invalidate = () => {
      if (keyboard.current !== null && !keyboardEnvironmentCurrent(keyboard.current))
        keyboard.current = null;
    };
    const unsubscribers = [
      useStore,
      useLaserStore,
      useFramePreparationStore,
      usePrintCutSessionStore,
      useExperimentalLaserFeatures,
    ].map((store) => store.subscribe(invalidate));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);
  const [draft, setDraft] = useState<{ kind: StartKind; point: Vec2 } | null>(null);
  const cancel = (): void => {
    drag.current = null;
    setDraft(null);
  };
  const state = { drag, keyboard, setDraft, cancel };
  return {
    draft: drag.current?.project === input.project ? draft : null,
    down: (kind: StartKind, anchor: Vec2, event: React.PointerEvent<HTMLButtonElement>) =>
      startPointerDrag(kind, anchor, event, input, state),
    move: (event: React.PointerEvent<HTMLButtonElement>) => movePointerDrag(event, input, state),
    up: (event: React.PointerEvent<HTMLButtonElement>) => finishPointerDrag(event, input, state),
    cancel,
    key: (
      kind: StartKind,
      anchor: Vec2,
      event: React.KeyboardEvent<HTMLButtonElement>,
      disabled = false,
    ) => handleStartKey(kind, anchor, event, disabled, input, state),
    keyboardReady: (kind: StartKind) =>
      reusableKeyboardSelection(keyboard.current, input, kind) !== null,
    keyboardPoint: (kind: StartKind) =>
      reusableKeyboardSelection(keyboard.current, input, kind)?.point ?? null,
  };
}

function currentInput(input: StartInteractionInput): boolean {
  return input.context?.sourceProject === useStore.getState().project && !startEditingBusy();
}

function currentDrag(active: Drag, input: StartInteractionInput): boolean {
  return (
    currentInput(input) &&
    active.project === input.project &&
    active.plan === input.plan &&
    active.epoch === useStore.getState().projectDocumentEpoch
  );
}

function startPointerDrag(
  kind: StartKind,
  anchor: Vec2,
  event: React.PointerEvent<HTMLButtonElement>,
  input: StartInteractionInput,
  { drag, keyboard }: InteractionState,
): void {
  if (event.button !== 0 || !currentInput(input)) return;
  const from = pointerScene(event, input);
  if (from === null) return;
  event.currentTarget.focus({ preventScroll: true });
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.setPointerCapture(event.pointerId);
  keyboard.current = null;
  drag.current = beginDrag(event.pointerId, kind, from, anchor, input.project, input.plan, {
    x: event.clientX,
    y: event.clientY,
  });
}

function movePointerDrag(
  event: React.PointerEvent<HTMLButtonElement>,
  input: StartInteractionInput,
  { drag, setDraft, cancel }: InteractionState,
): void {
  const active = drag.current;
  if (active === null || active.pointerId !== event.pointerId) return;
  if (!currentDrag(active, input)) {
    cancel();
    return;
  }
  const pointer = pointerScene(event, input);
  if (pointer === null || input.context === undefined) return;
  if (
    active.selection === null &&
    Math.hypot(event.clientX - active.screenFrom.x, event.clientY - active.screenFrom.y) < 3
  )
    return;
  const target = {
    x: active.anchor.x + pointer.x - active.from.x,
    y: active.anchor.y + pointer.y - active.from.y,
  };
  active.selection = selectCanvasStart(active.kind, target, input.plan, input.context);
  if (active.selection !== null) setDraft({ kind: active.kind, point: active.selection.point });
}

function finishPointerDrag(
  event: React.PointerEvent<HTMLButtonElement>,
  input: StartInteractionInput,
  { drag, cancel }: InteractionState,
): void {
  const active = drag.current;
  if (active?.pointerId !== event.pointerId) return;
  if (currentDrag(active, input) && active.selection !== null) {
    useStore.getState().setProjectStartPoints(active.selection.settings);
  }
  cancel();
}

function handleStartKey(
  kind: StartKind,
  anchor: Vec2,
  event: React.KeyboardEvent<HTMLButtonElement>,
  disabled: boolean,
  input: StartInteractionInput,
  { drag, keyboard, cancel }: InteractionState,
): void {
  if (!startKeyAllowsEdit(event, drag.current !== null ? cancel : undefined)) return;
  const previous = reusableKeyboardSelection(keyboard.current, input, kind);
  const context = previous?.context ?? input.context;
  if (
    context === undefined ||
    !keyboardContextAllowed(kind, context, previous !== null, disabled, input)
  )
    return;
  const selected = moveWithKeyboard(kind, previous?.point ?? anchor, event, {
    ...input,
    context,
  });
  if (selected === null) return;
  const current = useStore.getState().project;
  keyboard.current = {
    kind,
    point: selected.point,
    project: current,
    inputProject: input.project,
    plan: input.plan,
    context: { ...context, sourceProject: current },
    environment: keyboardEnvironment(),
  };
}

function keyboardContextAllowed(
  kind: StartKind,
  context: StartEditingContext,
  reused: boolean,
  disabled: boolean,
  input: StartInteractionInput,
): boolean {
  return (
    !startEditingBusy() &&
    startEditReason(kind, context) === null &&
    (reused || (!disabled && currentInput(input)))
  );
}

function startKeyAllowsEdit(
  event: React.KeyboardEvent<HTMLButtonElement>,
  cancel: (() => void) | undefined,
): boolean {
  if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
    event.stopPropagation();
    return false;
  }
  if (event.key === 'Escape') {
    if (cancel !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
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
): StartSelection | null {
  const delta = arrowDelta(event.key, event.shiftKey ? 10 : 1);
  if (delta === null || input.context === undefined) return null;
  event.preventDefault();
  event.stopPropagation();
  const selected = selectCanvasStart(
    kind,
    { x: anchor.x + delta.x, y: anchor.y + delta.y },
    input.plan,
    input.context,
  );
  if (selected !== null) useStore.getState().setProjectStartPoints(selected.settings);
  return selected;
}

function beginDrag(
  pointerId: number,
  kind: StartKind,
  from: Vec2,
  anchor: Vec2,
  project: Project,
  plan: CanvasMotionPlan,
  screenFrom: Vec2,
): Drag {
  return {
    pointerId,
    kind,
    from,
    screenFrom,
    anchor,
    project,
    plan,
    epoch: useStore.getState().projectDocumentEpoch,
    selection: null,
  };
}

function reusableKeyboardSelection(
  selection: KeyboardSelection | null,
  input: StartInteractionInput,
  kind: StartKind,
): KeyboardSelection | null {
  return selection !== null &&
    selection.kind === kind &&
    selection.plan === input.plan &&
    (selection.project === input.project || selection.inputProject === input.project) &&
    keyboardEnvironmentCurrent(selection)
    ? selection
    : null;
}

function keyboardEnvironmentCurrent(selection: KeyboardSelection): boolean {
  return (
    !startEditingBusy() &&
    useStore.getState().project === selection.project &&
    keyboardEnvironment().every((value, index) => value === selection.environment[index])
  );
}

function keyboardEnvironment(): ReadonlyArray<unknown> {
  const app = useStore.getState();
  const laser = useLaserStore.getState();
  return [
    app.projectDocumentEpoch,
    app.jobPlacement,
    app.outputScopeSettings,
    app.selectedObjectId,
    app.additionalSelectedIds,
    app.pendingUndo,
    app.externalGcodePreview,
    usePrintCutSessionStore.getState(),
    useExperimentalLaserFeatures.getState(),
    laser.controllerSessionEpoch,
    laser.trustedPositionEpoch,
    laser.workOriginActive,
    laser.wcoCache,
    laser.statusReport?.wco,
    laser.statusReport?.wPos,
    laser.statusReport?.mPos,
    laser.controllerSettings,
    laser.controllerBuildInfo,
    laser.homingState,
    laser.activeControllerKind,
    laser.activeControllerCommandSet,
    laser.detectedControllerKind,
  ];
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
