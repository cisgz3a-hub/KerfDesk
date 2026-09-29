// Camera Print and Cut in the dialog (ADR-443): Use selected marks sets the
// design targets, and Find marks with camera fills both registration points
// from one camera frame, without the machine, as a proposal the operator
// applies like head captures.

import { act, useState } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarkPairResult } from '../../core/camera/marks/match-mark-pair';
import { lookAt, savedCameraModel } from '../../core/camera/model/model-fixtures';
import { createProject } from '../../core/scene';
import type * as FrameSource from '../camera/frame-source';
import { clickControl, control, mountControl } from '../image-editor/control-audit-test-support';
import { useCameraStore } from '../state/camera-store';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { nativeBedCaptureFrameKey } from '../state/native-bed-frame';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useStore } from '../state/store';
import { svgObj } from '../state/test-helpers';
import type * as PrintCutCamera from './print-cut-camera';
import { PrintAndCutDialogHost } from './PrintAndCutDialogHost';
import { currentPrintCutOutputRegistration } from './print-cut-output';

const capture = vi.hoisted(() => vi.fn());
const locate = vi.hoisted(() => vi.fn());
vi.mock('../camera/frame-source', async (original) => ({
  ...(await original<typeof FrameSource>()),
  captureSourceFrame: capture,
}));
vi.mock('./print-cut-camera', async (original) => ({
  ...(await original<typeof PrintCutCamera>()),
  locatePrintCutMarks: locate,
}));

const frame = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).fill(255) };
const source = {
  kind: 'usb' as const,
  stream: {
    stream: {} as MediaStream,
    sourceId: 'print-cut-usb',
    resizeMode: 'none' as const,
    stop: vi.fn(),
  },
};

function markObject(id: string, x: number, y: number) {
  return {
    ...svgObj(id, ['#000000']),
    bounds: { minX: x - 4, minY: y - 4, maxX: x + 4, maxY: y + 4 },
  };
}

const FOUND: MarkPairResult = {
  kind: 'found',
  pair: {
    first: { centre: { x: 75, y: 62 }, sizeMm: 8, offCentreMm: 0 },
    second: { centre: { x: 335, y: 62 }, sizeMm: 8, offCentreMm: 0 },
    scale: 1,
    rotationDeg: 0,
    offsetMm: 5,
    otherPairs: 0,
  },
};

beforeEach(() => {
  const base = createProject();
  useStore.setState({
    undoStack: [],
    redoStack: [],
    project: {
      ...base,
      scene: { ...base.scene, objects: [markObject('right', 330, 60), markObject('left', 70, 60)] },
      device: {
        ...base.device,
        bedWidth: 400,
        bedHeight: 400,
        cameraModel: {
          ...savedCameraModel({
            version: 1,
            sourceKind: 'usb',
            sourceId: 'print-cut-usb',
            width: 8,
            height: 8,
            resizeMode: 'none',
          }),
          lens: {
            intrinsics: { fx: 4, fy: 4, cx: 4, cy: 4 },
            distortion: [0, 0, 0, 0],
            imageWidth: 8,
            imageHeight: 8,
          },
          pose: lookAt([200, 200, -400], [200, 200.001, 0]),
        },
      },
    },
    selectedObjectId: 'right',
    additionalSelectedIds: new Set(['left']),
  });
  // No machine connected: the camera needs none.
  useLaserStore.setState(initialLaserState());
  useCameraStore.setState({
    sourceState: { kind: 'live', source },
    surfaceHeightMm: 0.2,
    heightAreas: [],
  });
  usePrintCutSessionStore.getState().clear();
  useExperimentalLaserFeatures.setState((state) => ({
    features: { ...state.features, printAndCut: true },
  }));
  capture.mockReset();
  capture.mockResolvedValue(frame);
  locate.mockReset();
  locate.mockReturnValue(FOUND);
});

async function findMarks(host: HTMLElement): Promise<void> {
  await clickControl(host, 'Find marks with camera');
  // The search waits one tick so "Finding marks…" can paint.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

describe('Print and Cut with the camera', () => {
  it('fills both registration points from one frame, and Apply registers the design on them', async () => {
    const host = await mountControl(<PrintAndCutDialogHost onClose={() => undefined} />);
    await clickControl(host, 'Use selected marks');
    await findMarks(host);
    expect(capture).toHaveBeenCalledWith(source);
    expect(locate).toHaveBeenCalledWith(
      expect.objectContaining({
        bedWidthMm: 400,
        bedHeightMm: 400,
        surfaceHeightMm: 0.2,
        targets: { first: { x: 70, y: 60 }, second: { x: 330, y: 60 } },
        markSizeMm: { minMm: 8, maxMm: 8 },
      }),
    );
    const session = usePrintCutSessionStore.getState();
    expect(session.first).toMatchObject({ point: { x: 75, y: 62 }, epoch: 0, source: 'camera' });
    expect(session.second).toMatchObject({ point: { x: 335, y: 62 }, source: 'camera' });
    expect(host.textContent).toContain('Camera 75.00, 62.00');
    expect(host.textContent).toContain('The camera found both marks 260.0 mm apart');
    expect(host.textContent).toContain('Camera registration uses calibrated bed coordinates');
    expect(host.textContent).not.toContain('Registration uses controller-relative positions');

    await clickControl(host, 'Apply registration');
    const project = useStore.getState().project;
    expect(project.printAndCutTargets).toEqual({
      first: { x: 70, y: 60 },
      second: { x: 330, y: 60 },
    });
    expect(currentPrintCutOutputRegistration(project)).toMatchObject({
      scale: 1,
      translation: { x: 5, y: 2 },
    });
  });

  it('leaves the points as they were and says what it saw when no pair fits', async () => {
    locate.mockReturnValue({ kind: 'none', marksFound: 3 });
    const host = await mountControl(<PrintAndCutDialogHost onClose={() => undefined} />);
    await findMarks(host);
    expect(usePrintCutSessionStore.getState().first).toBeNull();
    expect(host.textContent).toContain('The camera found 3 mark-like shapes, but no two are');
  });

  it('needs a live camera', async () => {
    useCameraStore.setState({ sourceState: { kind: 'idle' } });
    const host = await mountControl(<PrintAndCutDialogHost onClose={() => undefined} />);
    expect(control(host, 'Find marks with camera').disabled).toBe(true);
  });

  it('explains incompatible capture bases and only applies a consistent pair', async () => {
    const key = nativeBedCaptureFrameKey(
      useStore.getState().project.device,
      useLaserStore.getState(),
    );
    const session = usePrintCutSessionStore.getState();
    session.capture('first', { x: 75, y: 62 }, 0, key, 'camera', 'bed');
    session.capture('second', { x: -300, y: 570 }, 0, key, 'head', 'controller-relative');
    const host = await mountControl(<PrintAndCutDialogHost onClose={() => undefined} />);
    // Targets on the two marks, so the consistent pair is at its printed size.
    await clickControl(host, 'Use selected marks');
    expect(control(host, 'Apply registration').disabled).toBe(true);
    expect(host.textContent).toContain('different coordinate bases');
    expect(host.textContent).not.toContain('Registration uses controller-relative positions');
    await act(async () => session.capture('second', { x: 335, y: 62 }, 0, key, 'camera', 'bed'));
    expect(control(host, 'Apply registration').disabled).toBe(false);
  });
});
function deferred() {
  let release!: (value: typeof frame) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<typeof frame>((resolve, fail) => {
    release = resolve;
    reject = fail;
  });
  return {
    promise,
    release: () => release(frame),
    reject: () => reject(new Error('Capture failed')),
  };
}

async function releaseCapture(release: () => void) {
  await act(async () => {
    release();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

describe('independent camera Print and Cut ownership probes', () => {
  it('does not publish a capture for targets edited while its frame was pending', async () => {
    const host = await mountControl(<PrintAndCutDialogHost onClose={() => undefined} />);
    await clickControl(host, 'Use selected marks');
    const pending = deferred();
    capture.mockReturnValueOnce(pending.promise);
    await clickControl(host, 'Find marks with camera');
    const secondX = host.querySelectorAll<HTMLInputElement>('input[type="number"]').item(2);
    await act(async () => {
      secondX.value = '200';
      Simulate.change(secondX);
    });
    await releaseCapture(pending.release);
    if (!control(host, 'Apply registration').disabled)
      await clickControl(host, 'Apply registration');
    expect(usePrintCutSessionStore.getState().first).toBeNull();
    expect(locate).not.toHaveBeenCalled();
    expect(useStore.getState().project.printAndCutTargets).toBeUndefined();
    expect(useStore.getState().undoStack).toEqual([]);
  });

  it.each([
    ['position-epoch', () => useLaserStore.setState({ trustedPositionEpoch: 12 })],
    [
      'controller-session',
      () =>
        useLaserStore.setState((s) => ({ controllerSessionEpoch: s.controllerSessionEpoch + 1 })),
    ],
    ['coordinate-frame', () => useStore.getState().updateDeviceProfile({ origin: 'rear-left' })],
    [
      'profile',
      () => useStore.getState().updateDeviceProfile({ profileId: 'replacement-profile' }),
    ],
    ['source-epoch', () => useCameraStore.setState((s) => ({ sourceEpoch: s.sourceEpoch + 1 }))],
  ] as const)('does not stamp an old frame with a changed %s', async (_name, change) => {
    const host = await mountControl(<PrintAndCutDialogHost onClose={() => undefined} />);
    await clickControl(host, 'Use selected marks');
    const pending = deferred();
    capture.mockReturnValueOnce(pending.promise);
    await clickControl(host, 'Find marks with camera');
    await act(async () => change());
    await releaseCapture(pending.release);
    expect(usePrintCutSessionStore.getState().first).toBeNull();
    expect(locate).not.toHaveBeenCalled();
  });

  it('rejects a delayed capture after actual New Project', async () => {
    const host = await mountControl(<PrintAndCutDialogHost onClose={() => undefined} />);
    const pending = deferred();
    capture.mockReturnValueOnce(pending.promise);
    await clickControl(host, 'Find marks with camera');
    await act(async () => useStore.getState().newProject());
    await releaseCapture(pending.release);
    expect(usePrintCutSessionStore.getState().first).toBeNull();
    expect(locate).not.toHaveBeenCalled();
  });

  it('rejects a delayed capture after Cancel actually unmounts the dialog', async () => {
    function Host() {
      const [show, setShow] = useState(true);
      return show ? <PrintAndCutDialogHost onClose={() => setShow(false)} /> : null;
    }
    const host = await mountControl(<Host />);
    const pending = deferred();
    capture.mockReturnValueOnce(pending.promise);
    await clickControl(host, 'Find marks with camera');
    await clickControl(host, 'Cancel');
    await releaseCapture(pending.release);
    expect(usePrintCutSessionStore.getState().first).toBeNull();
    expect(locate).not.toHaveBeenCalled();
  });

  it('keeps the successful Apply and Undo contract', async () => {
    const host = await mountControl(<PrintAndCutDialogHost onClose={() => undefined} />);
    const before = useStore.getState().project;
    await clickControl(host, 'Use selected marks');
    await findMarks(host);
    expect(useStore.getState().project).toBe(before);
    await clickControl(host, 'Apply registration');
    expect(currentPrintCutOutputRegistration(useStore.getState().project)).toMatchObject({
      scale: 1,
      translation: { x: 5, y: 2 },
    });
    expect(useStore.getState().undoStack).toEqual([before]);
    await act(async () => useStore.getState().undo());
    expect(useStore.getState().project).toEqual(before);
    await act(async () => useStore.getState().redo());
    expect(currentPrintCutOutputRegistration(useStore.getState().project)).toMatchObject({
      scale: 1,
      translation: { x: 5, y: 2 },
    });
    expect(useStore.getState().undoStack).toEqual([before]);
  });

  it.each(['release', 'reject'] as const)(
    'an abandoned capture %s does not settle a newer request',
    async (settle) => {
      const host = await mountControl(<PrintAndCutDialogHost onClose={() => undefined} />);
      await clickControl(host, 'Use selected marks');
      const first = deferred();
      const second = deferred();
      capture.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      await clickControl(host, 'Find marks with camera');
      const input = host.querySelectorAll<HTMLInputElement>('input[type="number"]').item(2);
      await act(async () => {
        input.value = '200';
        Simulate.change(input);
      });
      expect(control(host, 'Find marks with camera').disabled).toBe(false);
      await clickControl(host, 'Find marks with camera');
      await releaseCapture(first[settle]);
      expect(control(host, 'Finding marks…').disabled).toBe(true);
      expect(usePrintCutSessionStore.getState().first).toBeNull();
      expect(host.textContent).not.toContain('Could not capture');
      expect(locate).not.toHaveBeenCalled();
      if (FOUND.kind !== 'found') throw new Error('Expected pair fixture');
      locate.mockReturnValue({
        ...FOUND,
        pair: { ...FOUND.pair, second: { ...FOUND.pair.second, centre: { x: 205, y: 62 } } },
      });
      await releaseCapture(second.release);
      expect(usePrintCutSessionStore.getState().second?.point).toEqual({ x: 205, y: 62 });
      expect(control(host, 'Find marks with camera').disabled).toBe(false);
    },
  );

  it('settles a rejected capture, reports it and allows a fresh retry', async () => {
    const host = await mountControl(<PrintAndCutDialogHost onClose={() => undefined} />);
    capture.mockRejectedValueOnce(new Error('MediaStream attachment failed'));
    await findMarks(host);
    expect(host.textContent).toContain('Could not capture or read the camera frame. Try again.');
    expect(control(host, 'Find marks with camera').disabled).toBe(false);
    expect(usePrintCutSessionStore.getState().first).toBeNull();
    await findMarks(host);
    expect(usePrintCutSessionStore.getState().first?.source).toBe('camera');
  });
});
