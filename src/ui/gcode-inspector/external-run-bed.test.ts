// An external program's Frame outline is compared with the configured bed and
// no-go zones the way a jog is (ADR-630 Amendment 1, ADR-232): warnings only.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseStatusReport } from '../../core/controllers/grbl/status-parser';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { externalOutlineBedWarnings, OUTLINE_NOT_ON_BED } from './external-run-bed';

const ZONE = { id: 'clamp', name: 'Clamp', enabled: true, x: 100, y: 0, width: 50, height: 50 };

function device(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  return { ...DEFAULT_DEVICE_PROFILE, ...overrides };
}

/** Idle at machine X/Y with work offset `wco`. */
function idleAt(x: number, y: number, wco = { x: 0, y: 0, z: 0 }): void {
  useLaserStore.setState({
    connection: { kind: 'connected' },
    statusReport: parseStatusReport(`<Idle|MPos:${x},${y},0|FS:0,0>`),
    wcoCache: wco,
  });
}

beforeEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  useStore.setState({ project: createProject(DEFAULT_DEVICE_PROFILE) });
});

afterEach(() => {
  useLaserStore.setState(initialLaserState());
  resetStore();
});

describe('external run outline on the bed (ADR-630 Amendment 1)', () => {
  it('says nothing until connected', () => {
    const outline = { minX: 0, minY: 0, maxX: 6000, maxY: 0 };
    expect(externalOutlineBedWarnings(outline, useLaserStore.getState(), device())).toEqual([]);
  });

  it('warns when a typo sends the outline off the bed, and not when it fits', () => {
    idleAt(50, 50);
    const laser = useLaserStore.getState();
    // Read from the head at work X50 Y50: `G1 X6000` frames X50 to 6000.
    const typo = externalOutlineBedWarnings(
      { minX: 50, minY: 50, maxX: 6000, maxY: 50 },
      laser,
      device(),
    );
    expect(typo.join()).toContain('outside the configured machine bounds X 0.0 to 400.0');
    expect(typo.join()).toContain('X 50.0 to 6000.0');
    expect(
      externalOutlineBedWarnings({ minX: 50, minY: 50, maxX: 60, maxY: 70 }, laser, device()),
    ).toEqual([]);
  });

  it('places the work-coordinate outline with the controller offset', () => {
    // Work zero sits at machine X300: work X50 to 150 is machine X350 to 450.
    idleAt(350, 50, { x: 300, y: 0, z: 0 });
    const warnings = externalOutlineBedWarnings(
      { minX: 50, minY: 50, maxX: 150, maxY: 60 },
      useLaserStore.getState(),
      device(),
    );
    expect(warnings.join()).toContain('X 350.0 to 450.0');
  });

  it('names an enabled no-go zone the outline overlaps, and skips a disabled one', () => {
    idleAt(50, 10);
    const outline = { minX: 50, minY: 10, maxX: 120, maxY: 20 };
    const laser = useLaserStore.getState();
    expect(externalOutlineBedWarnings(outline, laser, device({ noGoZones: [ZONE] }))).toEqual([
      'The Frame outline overlaps the no-go zone "Clamp", so the program may move through it.',
    ]);
    const off = device({ noGoZones: [{ ...ZONE, enabled: false }] });
    expect(externalOutlineBedWarnings(outline, laser, off)).toEqual([]);
  });

  it('says so when a homed machine has no verified bed position', () => {
    idleAt(-350, -50);
    useLaserStore.setState({ homingState: 'confirmed' });
    const homed = device({ homing: { enabled: true, direction: 'rear-left' } });
    const warnings = externalOutlineBedWarnings(
      { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      useLaserStore.getState(),
      homed,
    );
    expect(warnings).toEqual([OUTLINE_NOT_ON_BED]);
  });
});
