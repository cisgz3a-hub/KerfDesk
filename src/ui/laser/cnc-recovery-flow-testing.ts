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

import { expect, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import type { PreflightIssue } from '../../core/preflight';
import type * as GcodeModule from '../../io/gcode';
import { emitPreparedGcode } from '../../io/gcode';
import { DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { frameVerificationForProject } from './frame-verification-testing';

const RECOVERY_WARNING_FIXTURE_COUNT = 130;
const RECOVERY_WARNING_INDEX_FILL = '0';
const RECOVERY_WARNING_INDEX_WIDTH = 3;
const RECOVERY_WARNING_MESSAGE_PREFIX = 'Recovery bed warning ';
const WARNING_CONFIRMATION_PREFIX = 'Controller warning:';
const WARNING_LIST_BULLET = '• ';
const EXPECTED_RECOVERY_SOURCE_EMISSION_COUNT = 2;
const EXPECTED_RECOVERY_JOB_EMISSION_COUNT = 1;
const RECOVERY_START_ALERT_PREFIX = 'Cannot start CNC recovery';
const RECOVERY_SOURCE_ALERT_PREFIX = 'Cannot resume job';
const RECOVERY_COMPILE_INTEGRITY_ISSUE: PreflightIssue = {
  code: 'empty-output',
  message: 'No cuts.',
};

type RecoveryJobCompileIntegrityInjection = {
  readonly assertRefusal: (
    started: boolean,
    startJobCallCount: number,
    alertMessages: ReadonlyArray<string>,
  ) => void;
};

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

/**
 * Force every `emitPreparedGcode` call to return its real output carrying the
 * injected preflight `issues`.
 *
 * A recovery flow emits more than once (source re-prepare, then the resume
 * job), so a one-shot mock is consumed before the refusal check is ever
 * reached. Overriding every call guarantees the issue arrives there. Requires
 * the calling suite to have `vi.mock`ed '../../io/gcode' with
 * `emitPreparedGcode: vi.fn(actual.emitPreparedGcode)`.
 */
export async function injectPreflightIssues(issues: ReadonlyArray<PreflightIssue>): Promise<void> {
  const actual = await vi.importActual<typeof GcodeModule>('../../io/gcode');
  vi.mocked(emitPreparedGcode).mockImplementation((prepared, options) => {
    const real = actual.emitPreparedGcode(prepared, options);
    return emissionWithInjectedPreflightIssues(real, issues);
  });
}

/**
 * Inject a compile-integrity issue only into the recovery-job emission,
 * leaving source re-preparation and sealed-artifact verification untouched.
 */
export async function injectRecoveryJobCompileIntegrityFailure(): Promise<RecoveryJobCompileIntegrityInjection> {
  const actual = await vi.importActual<typeof GcodeModule>('../../io/gcode');
  let sourceEmissionCount = 0;
  let recoveryJobEmissionCount = 0;
  vi.mocked(emitPreparedGcode).mockImplementation((prepared, options) => {
    const real = actual.emitPreparedGcode(prepared, options);
    if (options?.allowRotaryRaster !== undefined) {
      sourceEmissionCount += 1;
      return real;
    }
    recoveryJobEmissionCount += 1;
    return emissionWithInjectedPreflightIssues(real, [RECOVERY_COMPILE_INTEGRITY_ISSUE]);
  });
  return {
    assertRefusal: (started, startJobCallCount, alertMessages) => {
      expect(sourceEmissionCount).toBe(EXPECTED_RECOVERY_SOURCE_EMISSION_COUNT);
      expect(recoveryJobEmissionCount).toBe(EXPECTED_RECOVERY_JOB_EMISSION_COUNT);
      expect(started).toBe(false);
      expect(startJobCallCount).toBe(0);
      expect(alertMessages).toHaveLength(1);
      expect(alertMessages[0]).toContain(RECOVERY_START_ALERT_PREFIX);
      expect(alertMessages[0]).toContain(RECOVERY_COMPILE_INTEGRITY_ISSUE.message);
      expect(alertMessages[0]).not.toContain(RECOVERY_SOURCE_ALERT_PREFIX);
    },
  };
}

function emissionWithInjectedPreflightIssues(
  real: ReturnType<typeof emitPreparedGcode>,
  issues: ReadonlyArray<PreflightIssue>,
): ReturnType<typeof emitPreparedGcode> {
  const combinedIssues = [...real.preflight.issues, ...issues];
  return {
    ...real,
    preflight: {
      ok: real.preflight.ok && combinedIssues.length === 0,
      issues: combinedIssues,
    },
  };
}

/** Build enough distinct policy advisories to expose duplicate provenance inflation. */
export function recoveryWarningFixtureIssues(): ReadonlyArray<PreflightIssue> {
  return Array.from({ length: RECOVERY_WARNING_FIXTURE_COUNT }, (_, index) => ({
    code: 'out-of-bed',
    message: `${RECOVERY_WARNING_MESSAGE_PREFIX}${index
      .toString()
      .padStart(RECOVERY_WARNING_INDEX_WIDTH, RECOVERY_WARNING_INDEX_FILL)}`,
  }));
}

/** Extract the warning list from the recovery confirmation shown to the operator. */
export function recoveryWarningMessages(
  confirmations: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const warningConfirmation = confirmations.find((message) =>
    message.startsWith(WARNING_CONFIRMATION_PREFIX),
  );
  return (
    warningConfirmation
      ?.split('\n')
      .filter((line) => line.startsWith(WARNING_LIST_BULLET))
      .map((line) => line.slice(WARNING_LIST_BULLET.length)) ?? []
  );
}

/** Assert one ordered dialog/provenance copy of every injected warning. */
export function expectRecoveryWarningEvidence(
  confirmations: ReadonlyArray<string>,
  issues: ReadonlyArray<PreflightIssue>,
  archivedWarnings: ReadonlyArray<string> | undefined,
): void {
  const shownWarnings = recoveryWarningMessages(confirmations);
  const expectedMessages = issues.map((issue) => issue.message);
  const expectedSet = new Set(expectedMessages);
  expect(shownWarnings.filter((message) => expectedSet.has(message))).toEqual(expectedMessages);
  expect(new Set(shownWarnings).size).toBe(shownWarnings.length);
  expect(archivedWarnings).toEqual(shownWarnings);
}
