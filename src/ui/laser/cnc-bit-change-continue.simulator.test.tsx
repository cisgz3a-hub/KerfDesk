// Annoyance audit A2 B4-P1-1 (ADR-416 Amendment 4): multi-bit CNC jobs on the
// GRBL simulator, started through the real Frame, Job Review and Start flows
// and worked at each bit change on the rendered Machine rail and Live Motion
// bar. Before the fix the rail's Zero Z and probe recorded Work Z for the
// project's Default bit, so Continue never unlocked for any other bit and only
// Abort ended the job. With the hold's declaration switched off
// (holdEntrySpindleBitPatch returning {}), the two- and three-bit jobs below
// fail: the rail still shows the Default bit, and Zero Z records it.

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  multiBitCncProject as multiBitProject,
  starterBitName as bitName,
} from '../../__fixtures__/cnc-multi-bit-project';
import { useStore } from '../state';
import { appConfirm } from '../state/app-dialogs';
import { useLaserStore } from '../state/laser-store';
import { TOOL_CHANGE_Z_ZERO_REQUIRED_MESSAGE } from '../state/laser-store-helpers';
import { PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE } from '../state/work-z-zero-evidence';
import {
  chooseSpindleBit,
  continueBlock,
  controllerProblems,
  pressZeroZ,
  renderRail,
  runRenderedZProbe,
  runToHoldOrEnd,
  spindleBitSelect,
  type RenderedRail,
} from './cnc-bit-change-testing';
import { cncWorkZeroToolStartIssue } from './cnc-start-advisories';
import { ZERO_Z_OVERWRITE_TITLE } from './use-zero-z-action';
import {
  harness,
  installRecoveryStressHooks,
  programLines,
  startFramedJob,
  STRESS_TIMEOUT_MS,
  tick,
  type StressHarness,
} from './recovery-stress-testing';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));
// Frame's offers are asked in the app (ADR-707); the operator accepts them.
vi.mock('../state/app-dialogs', () => ({
  appConfirm: vi.fn(async () => true),
}));

installRecoveryStressHooks();

const FIRST = 'em-3175'; // the project's Default bit
const SECOND = 'em-6350';
const THIRD = 'em-9525';

type Run = { readonly h: StressHarness; readonly rail: RenderedRail; readonly from: number };

/** Zero Z with the first bit, Frame, Job Review, Start, and run to the first hold. */
async function startToFirstHold(bits: ReadonlyArray<string>): Promise<Run> {
  const h = await harness({
    project: multiBitProject(bits),
    simulator: { settings: [[32, '0']] },
  });
  const rail = await renderRail(h.simulator);
  await pressZeroZ(rail);
  expect(useLaserStore.getState().workZZeroEvidence?.toolId).toBe(bits[0]);
  const from = h.simulator.outbound().length;
  const { running } = await startFramedJob(h.repository);
  void running.catch(() => undefined);
  expect(await runToHoldOrEnd()).toBe('tool-change');
  return { h, rail, from };
}

async function continueToNextStop(rail: RenderedRail): Promise<string> {
  expect(continueBlock(rail)).toBeNull();
  await rail.click('Continue');
  await tick(200);
  return runToHoldOrEnd();
}

/** The job ran every bit's section and ended clean, and the project was not edited. */
async function expectCompleted(run: Run, bits: ReadonlyArray<string>): Promise<void> {
  await tick(2_000);
  expect(useLaserStore.getState().streamer).toBeNull();
  expect(controllerProblems()).toEqual([]);
  expect(run.h.simulator.state().machine).toBe('Idle');
  expect(run.h.simulator.state().spindle).toBe(0);
  const spindleStarts = programLines(run.h.simulator, run.from).filter((line) =>
    /^M3\b/.test(line),
  );
  expect(spindleStarts).toHaveLength(bits.length);
  const project = useStore.getState().project;
  expect(project.machine?.kind === 'cnc' ? project.machine.toolId : null).toBe(FIRST);
  expect(useStore.getState().dirty).toBe(false);
  expect(useStore.getState().undoStack).toHaveLength(0);
}

describe('B4-P1-1: a multi-bit CNC job continues past its bit changes', () => {
  it(
    'two bits: the hold names the bit, Zero Z records it, and the job completes',
    async () => {
      const bits = [FIRST, SECOND];
      const run = await startToFirstHold(bits);
      const { rail } = run;
      try {
        // The hold says what to do in the words of the controls it means.
        const held = rail.text();
        expect(held).toContain(`Load ${bitName(SECOND)} and re-zero Z on the stock top`);
        expect(held).toContain('Bit in the spindle, beside Zero Z');
        expect(held).not.toContain('Active bit');
        expect(held).toContain(
          `This job is waiting for ${bitName(SECOND)}. Zero Z and the probe now record Work Z for it.`,
        );
        // The hold declared the bit it asked for; the previous bit's Work Z is gone.
        expect(spindleBitSelect(rail).value).toBe(SECOND);
        expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
        expect(continueBlock(rail)).toBe(TOOL_CHANGE_Z_ZERO_REQUIRED_MESSAGE);

        await rail.click('Jog Z- 1 mm');
        await tick(1_500);
        await pressZeroZ(rail);
        expect(useLaserStore.getState().workZZeroEvidence).toMatchObject({
          source: 'manual-zero',
          toolId: SECOND,
        });

        expect(await continueToNextStop(rail)).toBe('ended');
        await expectCompleted(run, bits);
        // The bit stays declared after the job: it is still in the spindle.
        expect(spindleBitSelect(rail).value).toBe(SECOND);
      } finally {
        await rail.unmount();
      }
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'three bits: Zero Z at the first change, the touch-plate probe at the second',
    async () => {
      const bits = [FIRST, SECOND, THIRD];
      const run = await startToFirstHold(bits);
      const { rail, h } = run;
      try {
        expect(spindleBitSelect(rail).value).toBe(SECOND);
        await pressZeroZ(rail);
        expect(await continueToNextStop(rail)).toBe('tool-change');

        // The second hold asks for the third bit, which was never the Default bit.
        expect(useLaserStore.getState().pendingToolId).toBe(THIRD);
        expect(rail.text()).toContain(`Load ${bitName(THIRD)} and re-zero Z`);
        expect(spindleBitSelect(rail).value).toBe(THIRD);
        expect(continueBlock(rail)).toBe(TOOL_CHANGE_Z_ZERO_REQUIRED_MESSAGE);

        await runRenderedZProbe(rail, h.simulator);
        expect(useLaserStore.getState().workZZeroEvidence).toMatchObject({
          source: 'probe',
          toolId: THIRD,
        });
        // The plate is still on the stock: Continue names the button that clears it.
        expect(continueBlock(rail)).toBe(PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE);
        await rail.click('Dismiss reminder');

        expect(await continueToNextStop(rail)).toBe('ended');
        await expectCompleted(run, bits);
      } finally {
        await rail.unmount();
      }
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'Continue stays off while Work Z was zeroed with another bit declared',
    async () => {
      const bits = [FIRST, SECOND];
      const run = await startToFirstHold(bits);
      const { rail } = run;
      try {
        // The operator says the first bit is still in the spindle, and zeroes it.
        await chooseSpindleBit(rail, FIRST);
        expect(rail.text()).toContain(
          `This job is waiting for ${bitName(SECOND)}, but ${bitName(FIRST)} is chosen here.`,
        );
        await pressZeroZ(rail);
        expect(useLaserStore.getState().workZZeroEvidence?.toolId).toBe(FIRST);
        const blocked = continueBlock(rail);
        expect(blocked).toContain('Work Z belongs to a different bit');
        expect(blocked).toContain(`Load ${bitName(SECOND)}, choose it under Bit in the spindle`);

        // A press on the blocked Continue sends nothing and the job stays held.
        const sentBefore = run.h.simulator.outbound().filter((write) => write !== '?').length;
        await act(async () => rail.button('Continue').click());
        await tick(500);
        expect(useLaserStore.getState().streamer?.status).toBe('tool-change');
        expect(run.h.simulator.outbound().filter((write) => write !== '?')).toHaveLength(
          sentBefore,
        );

        // Choosing the right bit is not enough: the record keeps the bit it was taken with.
        await chooseSpindleBit(rail, SECOND);
        expect(continueBlock(rail)).toBe(blocked);

        // Zeroing again with the right bit declared unlocks Continue. The new bit
        // touches the stock at another height, so Zero Z asks before it replaces
        // the first zero, in the app and although the job is held.
        await rail.click('Jog Z- 1 mm');
        await tick(1_500);
        vi.mocked(appConfirm).mockClear();
        await pressZeroZ(rail);
        expect(vi.mocked(appConfirm).mock.calls.map(([options]) => options.title)).toEqual([
          ZERO_Z_OVERWRITE_TITLE,
        ]);
        expect(useLaserStore.getState().workZZeroEvidence?.toolId).toBe(SECOND);
        expect(await continueToNextStop(rail)).toBe('ended');
        await expectCompleted(run, bits);
      } finally {
        await rail.unmount();
      }
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'outside a job, the rail declares the bit a later operation or a recovery starts with',
    async () => {
      const h = await harness({
        project: multiBitProject([FIRST, SECOND]),
        simulator: { settings: [[32, '0']] },
      });
      const rail = await renderRail(h.simulator);
      try {
        const project = useStore.getState().project;
        const second = { id: SECOND, name: bitName(SECOND) };
        // Until a bit is declared the Default bit stands in, as before.
        expect(spindleBitSelect(rail).value).toBe(FIRST);
        await pressZeroZ(rail);
        const advisory = cncWorkZeroToolStartIssue(
          project,
          useLaserStore.getState().workZZeroEvidence,
          second,
          'The recovery program',
        );
        expect(advisory).toContain(`starts with ${bitName(SECOND)}`);
        expect(advisory).toContain('choose it under Bit in the spindle in the Machine rail');

        // Following those words clears it, without Machine Setup or a project edit.
        await chooseSpindleBit(rail, SECOND);
        await pressZeroZ(rail);
        const evidence = useLaserStore.getState().workZZeroEvidence;
        expect(evidence?.toolId).toBe(SECOND);
        expect(cncWorkZeroToolStartIssue(project, evidence, second)).toBeNull();
        expect(useStore.getState().project).toBe(project);
      } finally {
        await rail.unmount();
      }
    },
    STRESS_TIMEOUT_MS,
  );
});
