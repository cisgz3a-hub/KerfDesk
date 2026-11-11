// The status line's hover over "Relative view — physical bed position
// unverified" gives the reason for this firmware (annoyance audit A2
// B3-P2-2). It used to say "normal until your machine is connected and
// homed", which is untrue on a machine no Home can map.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  type ControllerKind,
  type DeviceProfile,
} from '../../core/devices';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { fingerprintGcode } from '../../core/recovery';
import { CANVAS_MOTION_SLOT_ID } from '../common/status-bar-slots';
import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { CanvasMotionBadge } from './canvas-motion-badge';
import {
  burnCheckBlocker,
  UNKNOWN_BED_POSITION_BURN_CHECK,
} from '../camera/job-watch/burn-check-run';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const GCODE = 'G21\nG90\nM4 S0\nG1 X10 F1000 S100\nM5';

function relativePlan(device: DeviceProfile): CanvasMotionPlan {
  return {
    manifest: buildMotionManifest(GCODE, { machineKind: 'laser' }),
    fingerprint: fingerprintGcode(GCODE),
    retentionKey: 'badge-relative',
    machineKind: 'laser',
    device,
    coordinateFrame: { kind: 'relative', jobOriginOffset: { x: 0, y: 0 } },
    framePerimeter: [],
    jobStart: { x: 0, y: 0 },
    approachFrom: null,
    capability: 'realtime',
    unavailableReason: null,
    resumed: false,
    positionEpoch: 0,
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function hoverText(device: DeviceProfile): Promise<string | null> {
  useStore.getState().updateDeviceProfile(device);
  host = document.createElement('div');
  const container = document.createElement('div');
  const slot = document.createElement('div');
  slot.id = CANVAS_MOTION_SLOT_ID;
  host.append(container, slot);
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(container);
    root.render(<CanvasMotionBadge overlay={{ plan: relativePlan(device), run: null }} />);
  });
  const status = host.querySelector('[data-testid="canvas-motion-status"]');
  expect(status?.textContent).toContain('Relative view — physical bed position unverified');
  return status?.getAttribute('title') ?? null;
}

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  host?.remove();
  useLaserStore.setState(initialLaserState());
  resetStore();
});

function profile(controllerKind: ControllerKind, homing: boolean): DeviceProfile {
  return {
    ...DEFAULT_DEVICE_PROFILE,
    controllerKind,
    homing: { enabled: homing, direction: 'front-left' },
  };
}

describe('the relative-view hover', () => {
  it('keeps the first-run words for a GRBL machine that can be homed', async () => {
    expect(await hoverText(profile('grbl-v1.1', true))).toMatch(
      /This is normal until your machine is connected and homed\.$/,
    );
  });

  it.each([
    ['marlin', /Marlin's home position and travel are fixed in the firmware build/],
    ['smoothieware', /Smoothieware's homing position is in the board's config file/],
    ['fluidnc', /FluidNC does not report where its homed coordinates sit on the bed/],
  ] as const)('tells a %s owner the real reason and what works', async (kind, why) => {
    const text = await hoverText(profile(kind, true));
    expect(text).toMatch(why);
    expect(text).toContain('Place the job with User Origin or Current Position and run Frame');
    expect(text).not.toMatch(/normal until your machine is connected and homed/);
  });

  it('tells a connected, homed Marlin owner the same thing', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      activeControllerKind: 'marlin',
      detectedControllerKind: 'marlin',
      homingState: 'confirmed',
    });
    expect(await hoverText(profile('marlin', true))).toMatch(
      /Home does not tell KerfDesk where the bed is/,
    );
  });

  it('says homing is off when that is why', async () => {
    expect(await hoverText(profile('grbl-v1.1', false))).toContain(
      'This machine profile has homing off',
    );
  });
});

describe('the camera burn check on a job with no bed position', () => {
  it('adds the reason it is given, and keeps its own sentence without one', () => {
    const plan = relativePlan(profile('marlin', true));
    const camera = { fixedModel: {}, modelIssue: null } as never;
    expect(burnCheckBlocker(plan, camera)).toBe(UNKNOWN_BED_POSITION_BURN_CHECK);
    expect(burnCheckBlocker(plan, camera, 'Because Marlin.')).toBe(
      `${UNKNOWN_BED_POSITION_BURN_CHECK} Because Marlin.`,
    );
  });
});
