import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { fingerprintGcode } from '../../core/recovery';
import { CANVAS_MOTION_SLOT_ID } from '../common/status-bar-slots';
import { useCameraStore } from '../state/camera-store';
import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import { CanvasMotionBadge } from './canvas-motion-badge';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const GCODE = 'G21\nG90\nM4 S300\nG1 X10 F1000\nM5';

// A homed User Origin job: drawn over its artwork, with its bed frame known.
const PLAN: CanvasMotionPlan = {
  manifest: buildMotionManifest(GCODE, { machineKind: 'laser' }),
  fingerprint: fingerprintGcode(GCODE),
  retentionKey: 'badge-camera',
  machineKind: 'laser',
  device: DEFAULT_DEVICE_PROFILE,
  coordinateFrame: {
    kind: 'relative',
    jobOriginOffset: { x: 0, y: 0 },
    bed: { kind: 'machine', workOffsetMm: { x: 40, y: 30, z: 0 } },
  },
  framePerimeter: [],
  jobStart: { x: 0, y: 0 },
  approachFrom: null,
  capability: 'realtime',
  unavailableReason: null,
  resumed: false,
  positionEpoch: 0,
};

afterEach(() => {
  useCameraStore.setState({ overlayVisible: false });
});

async function idleStatus(): Promise<string | null> {
  const host = document.createElement('div');
  const slot = document.createElement('div');
  slot.id = CANVAS_MOTION_SLOT_ID;
  host.append(slot);
  document.body.append(host);
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(<CanvasMotionBadge overlay={{ plan: PLAN, run: null }} />));
  const text = slot.querySelector('[data-testid="canvas-motion-status"]')?.textContent ?? null;
  await act(async () => root.unmount());
  host.remove();
  return text;
}

// ADR-642: a homed User Origin job is drawn over its artwork. The camera's
// picture shows the real bed, where that route does not burn, so the idle view
// says so; without the picture it adds nothing.
it('says a homed origin job is drawn over its artwork on the camera picture', async () => {
  useCameraStore.setState({ overlayVisible: false });
  expect(await idleStatus()).toBeNull();
  useCameraStore.setState({ overlayVisible: true });
  expect(await idleStatus()).toBe('Drawn over artwork — burns at your origin');
});
