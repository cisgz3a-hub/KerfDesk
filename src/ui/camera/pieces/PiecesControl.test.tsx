// The Camera panel's pieces (ADR-442): Find pieces searches a captured frame
// with the selected design's centre as the colour reference, lists each piece
// with its size and how the design will move onto it, and Place repeats the
// selection on every ticked piece as one undo step. Nothing changes before
// Place.

import { act } from 'react';
import type * as FrameSource from '../frame-source';
import { beforeEach, expect, it, vi } from 'vitest';
import { lookAt, savedCameraModel } from '../../../core/camera/model/model-fixtures';
import type { DetectedPiece } from '../../../core/camera/pieces/find-pieces';
import { createLayer } from '../../../core/scene';
import { clickControl, control, mountControl } from '../../image-editor/control-audit-test-support';
import { useStore } from '../../state';
import { useCameraStore as camera } from '../../state/camera-store';
import { resetStore, svgObj } from '../../state/test-helpers';
import { PiecesControl } from './PiecesControl';
import { usePieceScanStore } from './piece-scan-store';

const capture = vi.hoisted(() => vi.fn());
const scan = vi.hoisted(() => vi.fn());
vi.mock('../frame-source', async (original) => ({
  ...(await original<typeof FrameSource>()),
  captureSourceFrame: capture,
}));
vi.mock('./scan-bed-pieces', () => ({ scanBedPieces: scan }));

const frame = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).fill(255) };
const source = {
  kind: 'usb' as const,
  stream: {
    stream: {} as MediaStream,
    sourceId: 'pieces-usb',
    resizeMode: 'none' as const,
    stop: vi.fn(),
  },
};

function piece(x: number, y: number, axisDeg: number, partial = false): DetectedPiece {
  const rad = (axisDeg * Math.PI) / 180;
  const corner = (a: number, b: number) => ({
    x: x + a * 40 * Math.cos(rad) - b * 25 * Math.sin(rad),
    y: y + a * 40 * Math.sin(rad) + b * 25 * Math.cos(rad),
  });
  return {
    outline: [corner(1, 1), corner(-1, 1), corner(-1, -1), corner(1, -1)],
    rect: { centre: { x, y }, axisDeg, length: 80, width: 50 },
    areaMm2: 4000,
    centroid: { x, y },
    shape: 'oblong',
    headingDeg: null,
    partial,
  };
}

const PIECES = [piece(100, 60, 0), piece(250, 60, 30), piece(385, 200, 90, true)];

beforeEach(() => {
  resetStore();
  usePieceScanStore.getState().clear();
  capture.mockReset();
  capture.mockResolvedValue(frame);
  scan.mockReset();
  scan.mockReturnValue(PIECES);
  camera.setState({
    sourceState: { kind: 'live', source },
    surfaceHeightMm: 3,
    heightAreas: [],
    overlayVisible: false,
  });
  const project = useStore.getState().project;
  const design = {
    ...svgObj('design', ['#000000']),
    bounds: { minX: 90, minY: 50, maxX: 110, maxY: 70 },
  };
  useStore.setState({
    project: {
      ...project,
      scene: {
        ...project.scene,
        objects: [design],
        layers: [createLayer({ id: '#000000', color: '#000000' })],
      },
      device: {
        ...project.device,
        bedWidth: 400,
        bedHeight: 400,
        cameraModel: {
          ...savedCameraModel({
            version: 1,
            sourceKind: 'usb',
            sourceId: 'pieces-usb',
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
    selectedObjectId: 'design',
    additionalSelectedIds: new Set(),
    undoStack: [],
  });
});

async function findPieces(host: HTMLElement): Promise<void> {
  await clickControl(host, 'Find pieces');
  // The search waits one tick so "Finding pieces…" can paint.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

it('finds pieces with the design centre as the colour reference and changes nothing yet', async () => {
  const host = await mountControl(<PiecesControl />);
  expect(host.textContent).toContain('Lay out your blanks');
  const projectBefore = useStore.getState().project;
  await findPieces(host);
  expect(capture).toHaveBeenCalledWith(source);
  expect(scan).toHaveBeenCalledWith(
    expect.objectContaining({
      bedWidthMm: 400,
      bedHeightMm: 400,
      surfaceHeightMm: 3,
      reference: { x: 100, y: 60 },
    }),
  );
  expect(camera.getState().overlayVisible).toBe(true);
  expect(host.textContent).toContain('Found 3 pieces');
  expect(host.textContent).toContain('80.0 × 50.0 mm at 30.0°');
  expect(host.textContent).toContain('Your design is on this piece.');
  expect(host.textContent).toContain('moves +150.0, +0.0 mm, turns 30.0°');
  expect(host.textContent).toContain('Partly out of the camera’s view');
  expect(useStore.getState().project).toBe(projectBefore);
});

it('starts a piece the camera saw only in part left out, and places on the ticked pieces as one undo step', async () => {
  const host = await mountControl(<PiecesControl />);
  await findPieces(host);
  const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  expect(boxes.map((box) => box.checked)).toEqual([true, true, false]);
  const before = useStore.getState().project;
  await clickControl(host, 'Place selection on each piece');
  const after = useStore.getState();
  expect(after.project.scene.objects).toHaveLength(2);
  expect(after.project.scene.objects[0]?.transform).toEqual(before.scene.objects[0]?.transform);
  expect(after.project.scene.objects[1]?.transform.rotationDeg).toBeCloseTo(30);
  expect(after.undoStack).toEqual([before]);
  expect(host.textContent).toContain('Placed on 2 pieces. One Undo takes them all back.');
  expect(host.textContent).toContain('Frame traces the rectangle around all of them');
});

it('places a copy on a piece once it is ticked', async () => {
  const host = await mountControl(<PiecesControl />);
  await findPieces(host);
  const third = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[2];
  await act(async () => third?.click());
  await clickControl(host, 'Place selection on each piece');
  expect(useStore.getState().project.scene.objects).toHaveLength(3);
});

it('asks for a selection instead of placing nothing', async () => {
  const host = await mountControl(<PiecesControl />);
  await findPieces(host);
  await act(async () => useStore.setState({ selectedObjectId: null }));
  const before = useStore.getState().project;
  await clickControl(host, 'Place selection on each piece');
  expect(useStore.getState().project).toBe(before);
  expect(host.textContent).toContain('Select the design to place first.');
});

it('needs a live camera to search, and Clear drops the pieces', async () => {
  camera.setState({ sourceState: { kind: 'idle' } });
  const host = await mountControl(<PiecesControl />);
  expect(control(host, 'Find pieces').disabled).toBe(true);
  await act(async () => camera.setState({ sourceState: { kind: 'live', source } }));
  await findPieces(host);
  await clickControl(host, 'Clear');
  expect(usePieceScanStore.getState().scan).toBeNull();
  expect(host.textContent).toContain('Lay out your blanks');
});

it('says so when no piece stands out from the bed', async () => {
  scan.mockReturnValue([]);
  const host = await mountControl(<PiecesControl />);
  await findPieces(host);
  expect(host.textContent).toContain('No pieces found.');
});
