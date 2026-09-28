// The Camera panel's overlay row for a camera on the laser head (ADR-449):
// it waits for the head position, then offers captures that move the head
// instead of freezing one frame.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraModelRecord } from '../../core/camera/model/camera-model-record';
import { lookAt, savedCameraModel } from '../../core/camera/model/model-fixtures';
import type { Vec2 } from '../../core/scene';
import { mountControl } from '../image-editor/control-audit-test-support';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { resetStore } from '../state/test-helpers';
import { OverlayControls } from './OverlayControls';

let head: Vec2 | null = null;
vi.mock('./head/head-position', () => ({
  headPositionNow: () => head,
  useHeadPositionOnBed: () => head,
}));

const onHead: CameraModelRecord = {
  ...savedCameraModel({
    version: 1,
    sourceKind: 'usb',
    sourceId: 'head-cam',
    width: 1280,
    height: 960,
    resizeMode: 'none',
  }),
  pose: lookAt([100, 100, -70], [100, 100.001, 0]),
  mount: { kind: 'head', headAtCalibrationMm: { x: 100, y: 100 } },
};

beforeEach(() => {
  resetStore();
  head = null;
  const project = useStore.getState().project;
  useStore.setState({
    project: { ...project, device: { ...project.device, cameraModel: onHead } },
  });
  useCameraStore.setState({
    sourceState: {
      kind: 'live',
      source: {
        kind: 'usb',
        stream: {
          stream: {} as MediaStream,
          sourceId: 'head-cam',
          resizeMode: 'none',
          stop: vi.fn(),
        },
      },
    },
    overlayStill: null,
    bedPicture: null,
  });
});

function buttons(): string[] {
  return [...document.body.querySelectorAll('button')].map((button) => button.textContent ?? '');
}

describe('overlay controls for a camera on the head', () => {
  it('says what it needs while the head position is unknown', async () => {
    await mountControl(<OverlayControls />);
    expect(document.body.textContent).toContain('This camera rides on the laser head');
    expect(buttons()).not.toContain('Capture here');
  });

  it('offers captures that move the head instead of Update still', async () => {
    head = { x: 120, y: 90 };
    await mountControl(<OverlayControls />);
    expect(buttons()).toEqual(expect.arrayContaining(['Capture here', 'Capture bed']));
    expect(buttons()).not.toContain('Update still');
  });
});
