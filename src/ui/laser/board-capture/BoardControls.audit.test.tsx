import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from '../../state/laser-store';
import { useJogControlPreferences } from '../jog-control-preferences';
import { BoardArrayForm } from './BoardArrayForm';
import { BoardCaptureSteps } from './BoardCaptureSteps';
import { BoardFineJogControls } from './BoardFineJogControls';
import { BoardPlacementControls } from './BoardPlacementControls';
import { BoardShapeToggle } from './BoardShapeToggle';
import { BoardVerificationControls } from './BoardVerificationControls';
import { CircleBoardPlacementControls } from './CircleBoardPlacementControls';
import { CircleCaptureSteps } from './CircleCaptureSteps';
import type { BoardVerificationController } from './use-board-verification';

const placement = vi.hoisted(() => ({
  canAlign: true,
  canFit: true,
  alignToBox: vi.fn(),
  fitToBoard: vi.fn(),
  arrayToBoard: vi.fn(),
  removeBoard: vi.fn(),
}));
vi.mock('./use-board-placement', () => ({ useBoardPlacement: () => placement }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const rect = { kind: 'rect', origin: { x: 0, y: 0 }, widthMm: 100, heightMm: 60 } as const;
const circle = { kind: 'circle', center: { x: 50, y: 50 }, radiusMm: 40 } as const;
function verification(): BoardVerificationController {
  return {
    activeTarget: null,
    ready: false,
    adjusting: false,
    saving: false,
    cancelling: false,
    canCancelMove: true,
    epochValid: true,
    error: null,
    feedback: null,
    selectTarget: vi.fn(),
    acceptTarget: vi.fn(),
    adjustTarget: vi.fn(),
    confirmCurrentPosition: vi.fn(),
    cancel: vi.fn(),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  placement.canAlign = true;
  placement.canFit = true;
  useLaserStore.setState({ motionOperation: null });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function button(text: string): HTMLButtonElement {
  const node = [...host.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!node) throw new Error(`Missing button: ${text}`);
  return node;
}
function click(text: string): void {
  act(() => button(text).click());
}

describe('Board control audit', () => {
  it('array toggles between fill and explicit grid and refuses clicks while unavailable', () => {
    const onArray = vi.fn();
    act(() => root.render(<BoardArrayForm disabled={false} onArray={onArray} />));
    click('Array on board');
    expect(onArray).toHaveBeenLastCalledWith({ kind: 'fill', gapXMm: 2, gapYMm: 2 });
    act(() => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(host.querySelector('[aria-label="Rows"]')).not.toBeNull();
    click('Array on board');
    expect(onArray).toHaveBeenLastCalledWith({
      kind: 'grid',
      rows: 3,
      cols: 3,
      gapXMm: 2,
      gapYMm: 2,
    });
    act(() => root.render(<BoardArrayForm disabled={true} onArray={onArray} />));
    click('Array on board');
    expect(onArray).toHaveBeenCalledTimes(2);
  });

  it('rectangle placement dispatches each distinct anchor, fit, array, recapture and removal', () => {
    const onReset = vi.fn();
    act(() =>
      root.render(
        <BoardPlacementControls
          geometry={rect}
          disabled={false}
          verification={verification()}
          onReset={onReset}
        />,
      ),
    );
    for (const text of ['Center', 'Btm-left', 'Btm-right', 'Top-left', 'Top-right']) click(text);
    expect(placement.alignToBox.mock.calls).toEqual([
      ['center'],
      ['bottom-left'],
      ['bottom-right'],
      ['top-left'],
      ['top-right'],
    ]);
    click('Fit to board');
    expect(placement.fitToBoard).toHaveBeenCalledTimes(1);
    click('Array on board');
    expect(placement.arrayToBoard).toHaveBeenCalledWith({ kind: 'fill', gapXMm: 2, gapYMm: 2 });
    click('Capture a new board');
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(placement.removeBoard).not.toHaveBeenCalled();
    click('Remove board');
    expect(placement.removeBoard).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(2);
  });

  it('circle placement centers artwork, recaptures and removes only when the session is free', () => {
    const onReset = vi.fn();
    const controller = verification();
    act(() =>
      root.render(
        <CircleBoardPlacementControls
          geometry={circle}
          disabled={false}
          verification={controller}
          onReset={onReset}
        />,
      ),
    );
    click('Center');
    expect(placement.alignToBox).toHaveBeenCalledWith('center');
    click('Capture a new board');
    click('Remove board');
    expect(placement.removeBoard).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(2);
    act(() =>
      root.render(
        <CircleBoardPlacementControls
          geometry={circle}
          disabled={false}
          verification={{ ...controller, activeTarget: { kind: 'circle', anchor: 'rim-top' } }}
          onReset={onReset}
        />,
      ),
    );
    expect(button('Remove board').disabled).toBe(true);
    click('Remove board');
    click('Capture a new board');
    expect(placement.removeBoard).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(2);
  });

  it('shape choices send their typed shape and session-disabled clicks do nothing', () => {
    const onChange = vi.fn();
    act(() =>
      root.render(<BoardShapeToggle shapeKind="rect" disabled={false} onChange={onChange} />),
    );
    click('Circle');
    click('Rectangle');
    expect(onChange.mock.calls).toEqual([['circle'], ['rect']]);
    act(() =>
      root.render(<BoardShapeToggle shapeKind="rect" disabled={true} onChange={onChange} />),
    );
    click('Circle');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('rectangle capture Undo and Start over use their distinct callbacks and lock during a session operation', () => {
    const props = {
      corners: [{ x: 1, y: 1 }],
      livePosition: { x: 2, y: 2 },
      rect: null,
      disabled: false,
      sessionDisabled: false,
      onCapture: vi.fn(),
      onUndo: vi.fn(),
      onFinish: vi.fn(),
      onManualSize: vi.fn(),
      onReset: vi.fn(),
    };
    act(() => root.render(<BoardCaptureSteps {...props} />));
    click('Capture corner');
    click('Undo last');
    click('Start over');
    expect(props.onCapture).toHaveBeenCalledTimes(1);
    expect(props.onUndo).toHaveBeenCalledTimes(1);
    expect(props.onReset).toHaveBeenCalledTimes(1);
    act(() => root.render(<BoardCaptureSteps {...props} disabled={true} sessionDisabled={true} />));
    click('Capture corner');
    click('Undo last');
    click('Start over');
    expect(props.onCapture).toHaveBeenCalledTimes(1);
    expect(props.onUndo).toHaveBeenCalledTimes(1);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it.each(['rim-fit', 'marked-center'] as const)(
    'circle %s capture, undo, reset and method choices preserve their typed meaning',
    (method) => {
      const props = {
        method,
        corners: [{ x: 10, y: 10 }],
        livePosition: { x: 15, y: 15 },
        disabled: false,
        sessionDisabled: false,
        onMethodChange: vi.fn(),
        onCapture: vi.fn(),
        onUndo: vi.fn(),
        onMoveToPoint: vi.fn(async () => undefined),
        onFinish: vi.fn(async () => undefined),
      };
      act(() => root.render(<CircleCaptureSteps {...props} />));
      click(method === 'rim-fit' ? 'Capture rim point' : 'Capture edge');
      click('Undo last');
      click('Start over');
      click('Find center from rim');
      click('Center already marked');
      expect(props.onCapture).toHaveBeenCalledTimes(1);
      expect(props.onUndo).toHaveBeenCalledTimes(1);
      expect(props.onMethodChange.mock.calls).toEqual([[method], ['rim-fit'], ['marked-center']]);
      act(() =>
        root.render(<CircleCaptureSteps {...props} disabled={true} sessionDisabled={true} />),
      );
      click('Undo last');
      click('Start over');
      click('Find center from rim');
      click('Center already marked');
      expect(props.onUndo).toHaveBeenCalledTimes(1);
      expect(props.onMethodChange).toHaveBeenCalledTimes(3);
    },
  );

  it('verification target, accept, adjust, update and all cancel states dispatch exactly their handlers', () => {
    const controller = verification();
    act(() =>
      root.render(
        <BoardVerificationControls geometry={rect} disabled={false} controller={controller} />,
      ),
    );
    for (const text of ['Btm-left', 'Btm-right', 'Top-left', 'Top-right']) click(text);
    expect(controller.selectTarget).toHaveBeenCalledTimes(4);
    expect(controller.selectTarget).toHaveBeenLastCalledWith({ kind: 'rect', anchor: 'top-right' });
    const active = { ...controller, activeTarget: { kind: 'rect', anchor: 'top-right' } as const };
    act(() =>
      root.render(
        <BoardVerificationControls geometry={rect} disabled={false} controller={active} />,
      ),
    );
    click('Cancel check');
    expect(controller.cancel).toHaveBeenCalledTimes(1);
    act(() =>
      root.render(
        <BoardVerificationControls
          geometry={rect}
          disabled={false}
          controller={{ ...active, ready: true }}
        />,
      ),
    );
    click('Yes, correct');
    click('No, adjust it');
    click('Cancel');
    expect(controller.acceptTarget).toHaveBeenCalledTimes(1);
    expect(controller.adjustTarget).toHaveBeenCalledTimes(1);
    expect(controller.cancel).toHaveBeenCalledTimes(2);
    act(() =>
      root.render(
        <BoardVerificationControls
          geometry={rect}
          disabled={false}
          controller={{ ...active, ready: true, adjusting: true }}
        />,
      ),
    );
    click('Use current head position & update board');
    click('Cancel');
    expect(controller.confirmCurrentPosition).toHaveBeenCalledTimes(1);
    expect(controller.cancel).toHaveBeenCalledTimes(3);
  });

  it('each fine step button persists its distinct distance without requesting motion', () => {
    const originalJog = useLaserStore.getState().jog;
    const originalStep = useJogControlPreferences.getState().stepMm;
    const jog = vi.fn(async () => undefined);
    useLaserStore.setState({ jog });
    try {
      act(() => root.render(<BoardFineJogControls disabled={false} />));
      for (const step of [0.1, 1, 10]) {
        click(`${step} mm`);
        expect(useJogControlPreferences.getState().stepMm).toBe(step);
      }
      expect(jog).not.toHaveBeenCalled();
    } finally {
      useLaserStore.setState({ jog: originalJog });
      act(() => useJogControlPreferences.getState().setStepMm(originalStep));
    }
  });
});
