// The Camera panel's height areas (ADR-441 Amendment 2): an area starts
// around the selection (or mid-bed), its fields edit it, Remove drops it, and
// Trace area opens the normal trace dialog on just that part of the bed.

import { act } from 'react';
import type * as FrameSource from '../frame-source';
import { beforeEach, expect, it, vi } from 'vitest';
import { lookAt, savedCameraModel } from '../../../core/camera/model/model-fixtures';
import { clickControl, control, mountControl } from '../../image-editor/control-audit-test-support';
import { useStore } from '../../state';
import { useCameraStore as camera } from '../../state/camera-store';
import { resetStore, svgObj } from '../../state/test-helpers';
import { useUiStore } from '../../state/ui-store';
import { AREA_TRACE_PIXELS_PER_MM } from '../trace-from-camera';
import { HeightAreasControl } from './HeightAreasControl';

const capture = vi.hoisted(() => vi.fn());
vi.mock('../frame-source', async (original) => ({
  ...(await original<typeof FrameSource>()),
  captureSourceFrame: capture,
}));
vi.mock('../png-encode', () => ({ rgbaToPngDataUrl: () => 'data:image/png;base64,area' }));

const frame = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).fill(255) };
const source = {
  kind: 'usb' as const,
  stream: {
    stream: {} as MediaStream,
    sourceId: 'heights-usb',
    resizeMode: 'none' as const,
    stop: vi.fn(),
  },
};

beforeEach(() => {
  resetStore();
  capture.mockReset();
  capture.mockResolvedValue(frame);
  camera.setState({ sourceState: { kind: 'idle' }, surfaceHeightMm: 3, heightAreas: [] });
  const project = useStore.getState().project;
  useStore.setState({
    project: {
      ...project,
      device: {
        ...project.device,
        bedWidth: 400,
        bedHeight: 400,
        cameraModel: {
          ...savedCameraModel({
            version: 1,
            sourceKind: 'usb',
            sourceId: 'heights-usb',
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
  });
  useUiStore.setState({ imageDialog: null });
});

function field(host: ParentNode, label: string): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (input === null) throw new Error(`Field missing: ${label}`);
  return input;
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('starts an area in the middle of the bed at the material height when nothing is selected', async () => {
  const host = await mountControl(<HeightAreasControl />);
  expect(host.textContent).toContain('Something taller than the material');
  await clickControl(host, 'Add height area');
  expect(camera.getState().heightAreas).toMatchObject([
    { x: 150, y: 150, width: 100, height: 100, surfaceHeightMm: 3 },
  ]);
  expect(document.activeElement).toBe(field(host, 'Area 1 height above bed'));
});

it('starts an area around the selection, with a margin, and edits and removes it', async () => {
  const box = { ...svgObj('box', []), bounds: { minX: 100, minY: 120, maxX: 160, maxY: 150 } };
  const project = useStore.getState().project;
  useStore.setState({
    project: { ...project, scene: { ...project.scene, objects: [box] } },
    selectedObjectId: 'box',
  });
  const host = await mountControl(<HeightAreasControl />);
  await clickControl(host, 'Add height area');
  expect(camera.getState().heightAreas).toMatchObject([
    { x: 90, y: 110, width: 80, height: 50, surfaceHeightMm: 3 },
  ]);
  await type(field(host, 'Area 1 height above bed'), '42.5');
  await type(field(host, 'Area 1 width'), '-5');
  expect(camera.getState().heightAreas).toMatchObject([{ x: 90, width: 0, surfaceHeightMm: 42.5 }]);
  await clickControl(host, 'Remove');
  expect(camera.getState().heightAreas).toEqual([]);
});

it('traces only the area, at the finer area density, from a live camera', async () => {
  camera.setState({
    heightAreas: [{ id: 'lid', x: 150, y: 170, width: 60, height: 40, surfaceHeightMm: 20 }],
  });
  const host = await mountControl(<HeightAreasControl />);
  expect(control(host, 'Trace area').disabled).toBe(true);
  await act(async () => camera.setState({ sourceState: { kind: 'live', source } }));
  await clickControl(host, 'Trace area');
  expect(capture).toHaveBeenCalledWith(source);
  expect(useUiStore.getState().imageDialog).toMatchObject({
    sourceOrigin: 'camera-capture',
    source: {
      bounds: { minX: 150, minY: 170, maxX: 210, maxY: 210 },
      pixelWidth: 60 * AREA_TRACE_PIXELS_PER_MM,
      pixelHeight: 40 * AREA_TRACE_PIXELS_PER_MM,
    },
  });
});
