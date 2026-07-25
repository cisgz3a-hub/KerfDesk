// Shared store fixture for the two CNC recovery-flow suites.
//
// `configureReadyCncRecovery` was a byte-identical local function in both
// cnc-pass-recovery-flow.test.ts and cnc-supervised-recovery-flow.test.ts. A
// third copy was needed to pin the rule-7 preflight demotion, so it is
// extracted here instead (CLAUDE.md: extract on the second occurrence, not the
// third). `idleStatus` moved with it — it had no other use in either suite.
//
// The project is INJECTED rather than shared, because the two suites need
// genuinely different scenes: pass-recovery requires a multi-pass CNC layer
// (depthMm 3 / depthPerPassMm 1) so there are passes to resume from, while
// supervised recovery uses a plain layer. Each suite keeps its own
// `recoveryProject()`.
//
// `NOW`/`LATER` also stay local: the two suites deliberately use different
// dates, so hoisting them here would silently change one suite's fixtures.

import { vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { frameVerificationForProject } from './frame-verification-testing';

export const IDLE_STATUS: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

/**
 * Seed both stores with a connected, qualified CNC machine whose Work-Z is
 * zeroed and whose Frame is complete for `project` — the state a recovery flow
 * expects before it is asked to resume an interrupted run.
 *
 * `startJob` is stubbed with a no-op mock; a suite that asserts on streaming
 * replaces it with its own `vi.fn` afterward.
 */
export function configureReadyCncRecovery(project: Project): void {
  useStore.setState({
    project,
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
  });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: IDLE_STATUS,
    controllerSettings: { maxPowerS: 12_000, minPowerS: 0, laserModeEnabled: false },
    controllerQualification: { kind: 'qualified', epoch: 0, settings: 'verified' },
    ovCache: { feed: 100, rapid: 100, spindle: 100 },
    accessoryCache: { spindleCw: false, spindleCcw: false, flood: false, mist: false },
    workZReferenceEpoch: 7,
    workZZeroEvidence: {
      source: 'manual-zero',
      referenceEpoch: 7,
      toolId: DEFAULT_CNC_MACHINE_CONFIG.toolId,
    },
    // Frame-first (ADR-228): a completed Frame for this exact job is the one
    // Start policy gate; both the seeding Start and the recovery re-prepare
    // check it against the live store (null WCO, work origin inactive here).
    frameVerification: frameVerificationForProject(project),
    startJob: vi.fn(async () => undefined),
  });
}
