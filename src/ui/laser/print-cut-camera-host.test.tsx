// Camera Print and Cut in the dialog (ADR-443): Use selected marks sets the
// design targets, and Find marks with camera fills both registration points
// from one camera frame, without the machine, as a proposal the operator
// applies like head captures.

import { act } from 'react';
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
        markSizeMm: 8,
      }),
    );
    const session = usePrintCutSessionStore.getState();
    expect(session.first).toMatchObject({ point: { x: 75, y: 62 }, epoch: 0, source: 'camera' });
    expect(session.second).toMatchObject({ point: { x: 335, y: 62 }, source: 'camera' });
    expect(host.textContent).toContain('Camera 75.00, 62.00');
    expect(host.textContent).toContain('The camera found both marks 260.0 mm apart');

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
});
