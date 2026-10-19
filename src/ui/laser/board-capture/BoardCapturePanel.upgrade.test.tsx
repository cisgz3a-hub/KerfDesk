// ADR-636: custom-shape boards, origin at a machine point and the positioning
// light during capture — through the real panel.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../../core/controllers/grbl';
import { DEFAULT_CNC_MACHINE_CONFIG, findRegistrationBoxes } from '../../../core/scene';
import { polygonSelfIntersects } from '../../../core/scene/board-polygon';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { BOARD_ORIGIN_UNCONFIRMED_MESSAGE } from '../../state/laser-origin-restore';
import { useToastStore } from '../../state/toast-store';
import { useUiStore } from '../../state/ui-store';
import { BoardCapturePanel } from './BoardCapturePanel';
import type { PlaceBoardCanvasMarks } from './place-board-canvas-marks';
import type * as PlaceBoardCanvasModule from './PlaceBoardCanvas';
import { useBoardPointerPreference } from './use-board-pointer';

// Record what the page paints over its canvas (jsdom has no 2D context).
const canvas = vi.hoisted(() => ({ marks: null as PlaceBoardCanvasMarks | null }));
vi.mock('./PlaceBoardCanvas', async (importOriginal) => {
  const real = await importOriginal<typeof PlaceBoardCanvasModule>();
  return {
    PlaceBoardCanvas: (props: Parameters<typeof real.PlaceBoardCanvas>[0]) => {
      canvas.marks = props.marks;
      return real.PlaceBoardCanvas(props);
    },
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const original = useLaserStore.getState();
const mounted = new Set<() => Promise<void>>();

function idleAt(x: number, y: number): StatusReport {
  return {
    state: 'Idle',
    subState: null,
    mPos: { x, y, z: 0 },
    wPos: null,
    feed: null,
    spindle: null,
    wco: null,
  };
}

function button(host: HTMLElement, text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  if (found === undefined) throw new Error(`button "${text}" missing`);
  return found;
}

async function click(target: HTMLButtonElement): Promise<void> {
  await act(async () => {
    target.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function headAt(x: number, y: number): Promise<void> {
  await act(async () => {
    useLaserStore.setState({ statusReport: idleAt(x, y) });
  });
}

// Advance the work-origin version like the real origin transaction does.
function originWriter() {
  return vi.fn(async () => {
    useLaserStore.setState((state) => ({ workOriginVersion: (state.workOriginVersion ?? 0) + 1 }));
  });
}

async function render(): Promise<HTMLDivElement> {
  useUiStore.setState({ boardCapturePanelOpen: true });
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<BoardCapturePanel />);
  });
  const unmount = async (): Promise<void> => {
    await act(async () => root?.unmount());
    host.remove();
    mounted.delete(unmount);
  };
  mounted.add(unmount);
  return host;
}

function connectIdle(x = 0, y = 0): void {
  useLaserStore.setState({
    connection: { kind: 'connected' },
    statusReport: idleAt(x, y),
    wcoCache: null,
    motionOperation: null,
    controllerOperation: null,
    positioningLightEnabled: false,
  });
}

function withPointer(): void {
  const project = useStore.getState().project;
  useStore.setState({
    project: {
      ...project,
      device: {
        ...project.device,
        positioningLight: { onCommand: 'M7', offCommand: 'M9', offsetXmm: 7, offsetYmm: -4 },
      },
    },
  });
}

afterEach(async () => {
  for (const unmount of [...mounted]) await unmount();
  useLaserStore.setState({
    setOriginHere: original.setOriginHere,
    setOriginAtMachinePoint: original.setOriginAtMachinePoint,
    switchPositioningLightOn: original.switchPositioningLightOn,
    switchPositioningLightOff: original.switchPositioningLightOff,
    connection: { kind: 'disconnected' },
    statusReport: null,
    wcoCache: null,
    positioningLightEnabled: false,
  });
  useBoardPointerPreference.getState().setAutoPointer(true);
  for (const toast of useToastStore.getState().toasts)
    useToastStore.getState().dismissToast(toast.id);
  useUiStore.setState({ boardCapturePanelOpen: false });
  useStore.getState().newProject();
});

describe('Place board custom shape', () => {
  it('captures corners around the board and sets the origin at its front-left without motion', async () => {
    const setOriginHere = vi.fn(async () => undefined);
    const setOriginAtMachinePoint = originWriter();
    connectIdle();
    useLaserStore.setState({ setOriginHere, setOriginAtMachinePoint });
    const host = await render();
    await click(button(host, 'Custom shape'));
    const house = [
      [100, 50],
      [200, 50],
      [200, 120],
      [150, 160],
      [100, 120],
    ] as const;
    for (const [x, y] of house) {
      await headAt(x, y);
      await click(button(host, 'Capture corner'));
    }
    // Capturing never sets the origin: only creating the outline does.
    expect(setOriginHere).not.toHaveBeenCalled();
    expect(setOriginAtMachinePoint).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Shape: 100.0 × 110.0 mm');

    await click(button(host, 'Create board outline'));

    expect(setOriginAtMachinePoint).toHaveBeenCalledWith({ x: 100, y: 50 });
    const outline = findRegistrationBoxes(useStore.getState().project.scene)[0];
    expect(outline?.spec).toMatchObject({ kind: 'polyline', closed: true });
    expect(outline?.provenance).toBe('captured-board');
    expect(outline?.locked).toBe(true);
    expect(useStore.getState().jobPlacement).toMatchObject({
      startFrom: 'user-origin',
      anchor: 'front-left',
    });
    expect(host.textContent).toContain('Custom shape · 5 corners');
    expect(host.textContent).toContain('Measured: 100.0 × 110.0 mm');
  });

  it('draws a crossed capture on the map joined round the board, as the notice says', async () => {
    connectIdle();
    const host = await render();
    await click(button(host, 'Custom shape'));
    // Front-left, back-right, front-right, back-left: a bow-tie in capture order.
    for (const [x, y] of [
      [100, 50],
      [200, 120],
      [200, 50],
      [100, 120],
    ] as const) {
      await headAt(x, y);
      await click(button(host, 'Capture corner'));
    }
    expect(host.textContent).toContain('they will be joined around the board instead');
    const marks = canvas.marks;
    expect(marks?.points).toHaveLength(4);
    expect(polygonSelfIntersects(marks?.points ?? [])).toBe(true);
    expect(marks?.outlinePoints).toHaveLength(4);
    expect(polygonSelfIntersects(marks?.outlinePoints ?? [])).toBe(false);
  });

  it('sends the operator to Start over, not a second G92, when the origin was not confirmed', async () => {
    // The real action advances the work-origin version even when the
    // controller never confirms the offset: the G92 may have landed.
    const setOriginAtMachinePoint = vi.fn(async () => {
      useLaserStore.setState((state) => ({
        workOriginVersion: (state.workOriginVersion ?? 0) + 1,
      }));
      throw new Error(BOARD_ORIGIN_UNCONFIRMED_MESSAGE);
    });
    connectIdle();
    useLaserStore.setState({
      setOriginHere: vi.fn(async () => undefined),
      setOriginAtMachinePoint,
    });
    const host = await render();
    await click(button(host, 'Custom shape'));
    for (const [x, y] of [
      [100, 50],
      [200, 50],
      [150, 160],
    ] as const) {
      await headAt(x, y);
      await click(button(host, 'Capture corner'));
    }
    await click(button(host, 'Create board outline'));
    expect(setOriginAtMachinePoint).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('the work origin may have moved');
    expect(host.textContent).toContain('Start over and capture the board again');
    expect(host.textContent).not.toContain('try again');

    await click(button(host, 'Create board outline'));
    expect(setOriginAtMachinePoint).toHaveBeenCalledTimes(1);
    expect(findRegistrationBoxes(useStore.getState().project.scene)).toHaveLength(0);
    expect(host.textContent).toContain('Start over and capture the board again');
  });

  it('moves a rectangle origin to the front-left when another corner was captured first', async () => {
    const setOriginHere = originWriter();
    const setOriginAtMachinePoint = originWriter();
    connectIdle();
    useLaserStore.setState({ setOriginHere, setOriginAtMachinePoint });
    const host = await render();
    // Top-right first, then the rest.
    for (const [x, y] of [
      [110, 70],
      [10, 70],
      [10, 10],
      [110, 10],
    ] as const) {
      await headAt(x, y);
      await click(button(host, 'Capture corner'));
    }
    expect(setOriginHere).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('work origin moves to the front-left corner');
    await click(button(host, 'Create board outline'));
    expect(setOriginAtMachinePoint).toHaveBeenCalledWith({ x: 10, y: 10 });
    expect(host.textContent).toContain('Measured: 100.0 × 60.0 mm');
    expect(host.textContent).toContain('the work origin was moved to the front-left corner');
  });
});

describe('Place board positioning light', () => {
  it('switches the light on for capture, aims with it, and switches it off after', async () => {
    withPointer();
    connectIdle(10, 10);
    const on = vi.fn(async () => useLaserStore.setState({ positioningLightEnabled: true }));
    const off = vi.fn(async () => useLaserStore.setState({ positioningLightEnabled: false }));
    const setOriginAtMachinePoint = originWriter();
    useLaserStore.setState({
      switchPositioningLightOn: on,
      switchPositioningLightOff: off,
      setOriginHere: vi.fn(async () => undefined),
      setOriginAtMachinePoint,
    });
    const host = await render();
    expect(on).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Pointer on');

    // The light sits 7 mm right and 4 mm behind the beam (canvas Y down).
    await click(button(host, 'Capture corner'));
    expect(setOriginAtMachinePoint).toHaveBeenCalledWith({ x: 17, y: 14 });

    const width = host.querySelector<HTMLInputElement>('input[aria-label="Board width in mm"]');
    const height = host.querySelector<HTMLInputElement>('input[aria-label="Board height in mm"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(width, '120');
      width?.dispatchEvent(new Event('input', { bubbles: true }));
      setter?.call(height, '80');
      height?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button(host, 'Draw board at this size'));
    expect(host.textContent).toContain('Measured: 120.0 × 80.0 mm');
    expect(off).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledTimes(1);
  });

  it('reports a failed automatic switch-off after the page has closed', async () => {
    withPointer();
    connectIdle(10, 10);
    const on = vi.fn(async () => useLaserStore.setState({ positioningLightEnabled: true }));
    const off = vi.fn(async () => {
      throw new Error('Wait for the current controller command to settle.');
    });
    useLaserStore.setState({ switchPositioningLightOn: on, switchPositioningLightOff: off });
    await render();
    expect(on).toHaveBeenCalledTimes(1);
    await act(async () => {
      useUiStore.setState({ boardCapturePanelOpen: false });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(off).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain(
      'Could not switch the pointer off: Wait for the current controller command to settle.',
    );
  });

  it('leaves the light alone when the automatic switch is turned off', async () => {
    withPointer();
    connectIdle(10, 10);
    useBoardPointerPreference.getState().setAutoPointer(false);
    const on = vi.fn(async () => undefined);
    useLaserStore.setState({ switchPositioningLightOn: on });
    const host = await render();
    expect(on).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Pointer off');
  });

  it('never switches or aims with the light in CNC mode, where its M-code may be coolant', async () => {
    withPointer();
    const project = useStore.getState().project;
    useStore.setState({ project: { ...project, machine: DEFAULT_CNC_MACHINE_CONFIG } });
    try {
      connectIdle(10, 10);
      const on = vi.fn(async () => useLaserStore.setState({ positioningLightEnabled: true }));
      const setOriginHere = originWriter();
      const setOriginAtMachinePoint = originWriter();
      useLaserStore.setState({
        switchPositioningLightOn: on,
        setOriginHere,
        setOriginAtMachinePoint,
      });
      const host = await render();
      expect(on).not.toHaveBeenCalled();
      expect(host.textContent).not.toContain('Pointer');
      // A light left recorded on (switched in Laser mode) must not shift the
      // origin away from the bit by the beam-to-light offset.
      await act(async () => useLaserStore.setState({ positioningLightEnabled: true }));
      await click(button(host, 'Capture corner'));
      expect(setOriginHere).toHaveBeenCalledTimes(1);
      expect(setOriginAtMachinePoint).not.toHaveBeenCalled();
    } finally {
      // New Project keeps the machine kind, so put Laser mode back.
      await act(async () =>
        useStore.setState({
          project: { ...useStore.getState().project, machine: project.machine },
        }),
      );
    }
  });

  it('offers to set up a light on machines without one', async () => {
    const project = useStore.getState().project;
    const { positioningLight: _light, ...device } = project.device;
    useStore.setState({ project: { ...project, device } });
    connectIdle();
    const host = await render();
    expect(host.textContent).toContain('Set it up');
  });
});
