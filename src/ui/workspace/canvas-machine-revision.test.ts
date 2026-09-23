import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { stockNativeEvidence } from '../state/native-bed-frame.test-support';
import {
  canvasMachineRevision,
  deriveCanvasMachineRevision,
  type CanvasRevisionSource,
} from './canvas-machine-revision';

const original = useLaserStore.getState();

afterEach(() => {
  vi.restoreAllMocks();
  useLaserStore.setState(original, true);
});

function report(state: StatusReport['state'], x: number, wco: StatusReport['wco'] = null) {
  return {
    state,
    subState: null,
    mPos: { x, y: 2, z: 0 },
    wPos: { x, y: 2, z: 0 },
    feed: 0,
    spindle: 0,
    wco,
  } satisfies StatusReport;
}

const base: CanvasRevisionSource = {
  ...initialLaserState(),
  ...stockNativeEvidence(DEFAULT_DEVICE_PROFILE),
  connection: { kind: 'connected' },
  statusReport: report('Idle', 0),
};

// One field changed at a time, then back: a field the key reads but the memo
// does not compare would surface as a stale string on exactly that step.
const variants: ReadonlyArray<readonly [string, Partial<CanvasRevisionSource>]> = [
  ['disconnected report', { statusReport: null }],
  ['moved idle head', { statusReport: report('Idle', 12.5) }],
  ['same-frame WCO', { statusReport: report('Idle', 0, { x: 5, y: 0, z: 0 }) }],
  ['running head', { statusReport: report('Run', 40) }],
  ['connection', { connection: { kind: 'disconnected' } }],
  ['status query', { capabilities: { ...base.capabilities, statusQuery: 'queued-poll' } }],
  ['report inches', { controllerSettings: { ...base.controllerSettings, reportInches: true } }],
  ['work origin', { workOriginActive: true }],
  ['position epoch', { trustedPositionEpoch: 3 }],
  ['cached WCO', { wcoCache: { x: 1, y: 2, z: 0 } }],
  ['homing', { homingState: 'unknown' }],
  ['session epoch', { controllerSessionEpoch: 8 }],
  ['settings stamp', { controllerSettingsObservation: { sessionEpoch: 6, observedAt: 1 } }],
  ['build info', { controllerBuildInfo: null }],
  ['build stamp', { controllerBuildInfoObservation: { sessionEpoch: 6, observedAt: 1 } }],
  ['active kind', { activeControllerKind: 'grblhal' }],
  ['command set', { activeControllerCommandSet: 'creality-falcon-a1-pro' }],
  ['detected kind', { detectedControllerKind: null }],
];

describe('canvasMachineRevision memo', () => {
  it.each(variants)('keys a change of %s exactly like the unmemoized revision', (_, change) => {
    const changed = { ...base, ...change };
    expect(deriveCanvasMachineRevision(changed)).not.toBe(deriveCanvasMachineRevision(base));
    for (const state of [base, changed, changed, base, { ...base }, changed]) {
      expect(canvasMachineRevision(state)).toBe(deriveCanvasMachineRevision(state));
    }
  });

  it('does not rebuild the key for store sets that leave its fields alone', () => {
    useLaserStore.setState({ ...base });
    const before = canvasMachineRevision(useLaserStore.getState());
    const stringify = vi.spyOn(JSON, 'stringify');
    // What a streamed job writes per acknowledged line: bookkeeping, not position.
    for (let ack = 1; ack <= 300; ack += 1) {
      useLaserStore.setState({ pendingUntrackedAcks: ack % 3, log: [`ok ${ack}`] });
      expect(canvasMachineRevision(useLaserStore.getState())).toBe(before);
    }
    expect(stringify).not.toHaveBeenCalled();

    useLaserStore.setState({ statusReport: report('Idle', 30) });
    expect(canvasMachineRevision(useLaserStore.getState())).toBe(
      deriveCanvasMachineRevision(useLaserStore.getState()),
    );
  });
});
