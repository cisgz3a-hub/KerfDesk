// Rolling audit 2026-10-21, 05-P2-1: Start from line filled in the automatic
// restart line of the saved interrupted run for any laser capsule. When that
// run was itself a resumed recovery or a painted second pass, the line counted
// the run's own program, and Resume from line replayed it on the project's
// full program: a resume of the stretch already burned. The field now stays
// unfilled for such a run, its hint says why, and the confirmation names the
// program the line counts.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { countSendableLines, fingerprintGcode } from '../../core/recovery';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { useStore } from '../state';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import {
  RecoveryRepository,
  recoveryRepository,
  type RecoveryCapsule,
  type ExecutionArtifactV1,
} from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { automaticRecoveryRestart } from './laser-recovery-automatic-restart';
import { buildLaserResumeProgram } from './laser-resume-program';
import { forgetManualRestartsForTests } from './manual-restart-source';
import { prepareRecoverySource } from './start-job-source';
import { StartFromLineControl } from './StartFromLineControl';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  // Declining stops each flow before anything streams. The prepared source's
  // warnings are accepted so the flow reaches the resume question
  // (ADR-232 Amendment 1).
  jobAwareConfirm: vi.fn((question: string) => question.startsWith('Controller warning:')),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ACKED = 20;
// Placement anchored at the head, so the project compiles without a work origin.
const CURRENT_POSITION = { startFrom: 'current-position', anchor: 'front-left' } as const;

let host: HTMLDivElement;
let root: Root;

function zigzagProject(): Project {
  const points = Array.from({ length: 60 }, (_, i) => ({ x: 1 + i, y: i % 2 === 0 ? 1 : 9 }));
  return {
    ...createProject(),
    scene: {
      layers: [createLayer({ id: 'zigzag', color: '#ff0000' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'zigzag',
          source: 'zigzag.svg',
          bounds: { minX: 1, minY: 1, maxX: 60, maxY: 9 },
          transform: IDENTITY_TRANSFORM,
          paths: [{ color: '#ff0000', polylines: [{ closed: false, points }] }],
        },
      ],
    },
  };
}

async function projectProgram(): Promise<string> {
  const source = await prepareRecoverySource();
  if (source === null) {
    const refusal = vi.mocked(jobAwareAlert).mock.calls.at(-1)?.[0];
    throw new Error(`The project did not compile: ${String(refusal)}`);
  }
  return source.gcode;
}

/** A capsule saved by a run whose archived program is `gcode`. */
async function capsuleFor(
  gcode: string,
  chains: Pick<ExecutionArtifactV1, 'laserResumeChain' | 'laserSecondPassChain'>,
): Promise<RecoveryCapsule> {
  const base = await createCurrentTestExecutionArtifact({
    runId: 'saved-run',
    gcode,
    project: useStore.getState().project,
  });
  const artifact: ExecutionArtifactV1 = { ...base, ...chains };
  return {
    runId: artifact.runId,
    artifactKind: artifact.kind,
    revision: 1,
    ackedLines: ACKED,
    sendableLines: countSendableLines(gcode),
    interruption: { kind: 'disconnect', message: 'The serial connection closed during the job.' },
    updatedAtIso: '2026-10-21T10:00:00.000Z',
    artifact,
  };
}

/** The interrupted run of a resumed recovery: the project's program resumed
 * from its 30th burn line. */
async function resumedRunCapsule(program: string): Promise<RecoveryCapsule> {
  const lines = program.split('\n');
  const fromLine = lines.findIndex((line, index) => index > 0 && /^G1 /.test(line)) + 30;
  const resume = buildLaserResumeProgram(program, fromLine, useStore.getState().project.device);
  if (resume.kind === 'error') throw new Error(resume.reason);
  return capsuleFor(resume.lines.join('\n'), { laserResumeChain: [{ fromLine }] });
}

function showCapsule(capsule: RecoveryCapsule): void {
  const empty = new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
  }).getSnapshot();
  vi.spyOn(recoveryRepository, 'getSnapshot').mockReturnValue({
    ...empty,
    loaded: true,
    recoveryCapsule: capsule,
  });
}

function renderControl(): void {
  act(() =>
    root.render(<StartFromLineControl disabled={false} busy={false} machineKind="laser" />),
  );
  const disclosure = host.querySelector('details');
  if (disclosure !== null) disclosure.open = true;
}

function field(): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Resume from G-code line"]');
  if (input === null) throw new Error('Missing line field.');
  return input;
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
  if (found === undefined) throw new Error(`Missing button: ${label}`);
  return found;
}

/** The resume confirmation the operator was asked, after pressing Resume. */
async function resumeConfirmationAsked(): Promise<string> {
  await act(async () => {
    button('Resume from line').click();
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
  });
  await vi.waitFor(() =>
    expect(vi.mocked(jobAwareConfirm).mock.calls.map(([question]) => question)).toContainEqual(
      expect.stringContaining('Review resume from requested line'),
    ),
  );
  const questions = vi.mocked(jobAwareConfirm).mock.calls.map(([question]) => question);
  return questions.find((question) => question.includes('Review resume from requested line')) ?? '';
}

beforeEach(() => {
  forgetManualRestartsForTests();
  useStore.setState({ project: zigzagProject(), jobPlacement: CURRENT_POSITION });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 0, y: 0, z: 0 },
      wPos: null,
      wco: { x: 0, y: 0, z: 0 },
      feed: 0,
      spindle: 0,
    },
    capabilities: grblDriver.capabilities,
    controllerSessionEpoch: 9,
    controllerSettings: { maxPowerS: 1_000, minPowerS: 0, laserModeEnabled: true },
    controllerSettingsObservation: { sessionEpoch: 9, observedAt: 1 },
    controllerQualification: { kind: 'qualified', epoch: 9, settings: 'verified' },
  });
  vi.mocked(jobAwareConfirm).mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useStore.setState({ project: createProject() });
  useLaserStore.setState(initialLaserState());
  vi.restoreAllMocks();
});

describe('Start from line after a resumed or painted run (05-P2-1)', () => {
  it('fills in the automatic line of a run that streamed the project program', async () => {
    const program = await projectProgram();
    const capsule = await capsuleFor(program, {});
    showCapsule(capsule);
    renderControl();

    const automatic = automaticRecoveryRestart(capsule)?.line;
    expect(automatic).toBeGreaterThan(1);
    expect(field().value).toBe(String(automatic));
    expect(host.textContent).toContain(`Its automatic restart is file line ${automatic}`);
  });

  it('leaves a resumed recovery’s line out and names the program the line counts', async () => {
    const program = await projectProgram();
    const capsule = await resumedRunCapsule(program);
    // The hazard: the saved run's automatic line is a different movement in
    // the project's own program, the one Resume from line replays.
    const automatic = automaticRecoveryRestart(capsule)?.line ?? 0;
    const resumedText = capsule.artifact.kind === 'exact-execution' ? capsule.artifact.gcode : '';
    expect(resumedText.split('\n')[automatic - 1]).not.toBe(program.split('\n')[automatic - 1]);

    showCapsule(capsule);
    renderControl();
    expect(field().value).toBe('1');
    expect(host.textContent).toContain('was a resumed recovery');
    expect(host.textContent).toContain('none is filled in');
    expect(host.textContent).not.toContain('filled in above');

    const question = await resumeConfirmationAsked();
    expect(question).toContain('Review resume from requested line 1:');
    expect(question).toContain(
      `Line numbers count this project's full program as it compiles now (${program.split('\n').length} lines).`,
    );
    expect(question).toContain('The saved interrupted job ran a resume program');
  });

  it('leaves a painted second pass’s line out', async () => {
    const program = await projectProgram();
    const capsule = await capsuleFor(program, {
      laserSecondPassChain: [
        {
          sourceRunId: 'original-run',
          sourceFingerprint: fingerprintGcode(program),
          resumeChainBefore: [],
          selection: { version: 1, maxPowerS: 1_000, strokes: [] },
          writerVersion: 3,
        },
      ],
    });
    showCapsule(capsule);
    renderControl();

    expect(field().value).toBe('1');
    expect(host.textContent).toContain('was a painted second pass');
    const question = await resumeConfirmationAsked();
    expect(question).toContain('The saved interrupted job ran a painted second pass');
  });
});
