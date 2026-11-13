// CNC audit v3 N5 (ADR-215 Amendments 3 and 4): pass recovery after an Abort or a
// lost link, on the GRBL simulator with its stock 15-block planner, through
// the real Machine rail, Frame, Job Review, Start, store, checkpoint tracker,
// recovery repository and recovery flow.
//
// - N5-P1-1: Zero Z at a bit-change hold writes G92, which the Abort's soft
//   reset clears on stock GRBL, so the work offset fell back to the one
//   archived at Start and "Position retained" passed; the reset also voided the
//   Work Z record, so the start-bit check passed by default.
// - N5-P2-1: the held M0 is never sent, so the default rewound across it into
//   the previous bit's operation.
// - N5r-P1-1: a board that resets when its port reopens restarts with machine
//   position zeroed where the head stands, and "Position retained" was still
//   offered.
// Each case below failed on main before the fix.

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createGrblSimulator, type GrblSimulator } from '../../__fixtures__/controllers';
import { GRBL_PLANNER_BLOCKS } from '../../__fixtures__/controllers/grbl-sim-planner';
import {
  multiBitCncProject,
  starterBitName as bitName,
} from '../../__fixtures__/cnc-multi-bit-project';
import type { Project } from '../../core/scene';
import { useStore } from '../state';
import { jobAwareAlert, jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import type { RecoveryCapsule } from '../state/recovery';
import { pressZeroZ, renderRail, runToHoldOrEnd } from './cnc-bit-change-testing';
import { runCncPassRecoveryFlow } from './cnc-pass-recovery-flow';
import {
  buildCncPassRecoveryModel,
  cncPassRecoveryDefaultPoint,
  type CncPassRecoveryModel,
} from './cnc-pass-recovery-model';
import { retainedPositionIssue, type CncPassRecoveryReview } from './cnc-pass-recovery-review';
import { liveCncRetainedWorkZIssue } from './cnc-recovery-work-z';
import {
  drive,
  expectCapsuleFor,
  harness,
  installRecoveryStressHooks,
  programLines,
  startFramedJob,
  STRESS_TIMEOUT_MS,
  tick,
} from './recovery-stress-testing';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
  jobAwarePrompt: vi.fn(() => null),
}));
vi.mock('../state/app-dialogs', () => ({
  appConfirm: vi.fn(async () => true),
}));

installRecoveryStressHooks();

const FIRST = 'em-3175';
const SECOND = 'em-6350';
const SETTINGS: ReadonlyArray<readonly [number, string]> = [
  [32, '0'],
  [30, '12000'],
];

function review(
  position: CncPassRecoveryReview['position']['kind'],
  pass: { readonly groupIndex: number; readonly passIndex: number },
): CncPassRecoveryReview {
  return {
    cutterClear: true,
    spindleStopped: true,
    workholdingConfirmed: true,
    toolConfirmed: true,
    position: { kind: position },
    ...pass,
  };
}

/** The wizard's model, with the live Work Z the wizard reads. */
function wizardModel(capsule: RecoveryCapsule): CncPassRecoveryModel {
  const laser = useLaserStore.getState();
  return buildCncPassRecoveryModel(
    capsule,
    laser.wcoCache,
    laser.controllerSettings?.reportInches,
    liveCncRetainedWorkZIssue(laser, capsule, useStore.getState().project),
  );
}

function alerts(): string[] {
  return vi.mocked(jobAwareAlert).mock.calls.map(([text]) => String(text));
}

function confirms(): string[] {
  return vi.mocked(jobAwareConfirm).mock.calls.map(([text]) => String(text));
}

type Rail = Awaited<ReturnType<typeof renderRail>>;

/** The touch plate: test the probe input (status reports must see it close
 * and open again), run the probe, and take the plate away. It writes
 * `G10 L20 P0`, a G54 every reset keeps. */
async function plateProbe(rail: Rail, simulator: GrblSimulator) {
  await tick(1_500);
  simulator.setProbeInput(true);
  await tick(1_500);
  simulator.setProbeInput(false);
  await tick(1_500);
  await rail.click('Run probe');
  for (let step = 0; step < 400 && useLaserStore.getState().probeBusy; step += 1) await tick(50);
  await tick(1_500);
  await rail.click('Dismiss reminder');
  await tick(300);
  expect(useLaserStore.getState().workZZeroEvidence).toMatchObject({ source: 'probe' });
}

async function probeStartZero(rail: Rail, simulator: GrblSimulator) {
  await plateProbe(rail, simulator);
}

/** Two bits, Start zero by probe, run to the bit change, zero the second bit
 * (it sticks out 2 mm further) and Abort at the hold. */
async function abortAtZeroedHold(zero: 'zero-z' | 'probe') {
  const h = await harness({
    project: multiBitCncProject([FIRST, SECOND]),
    simulator: { settings: SETTINGS },
  });
  const rail = await renderRail(h.simulator);
  await probeStartZero(rail, h.simulator);
  const { runId, running } = await startFramedJob(h.repository);
  void running.catch(() => undefined);
  expect(await runToHoldOrEnd()).toBe('tool-change');
  for (let step = 0; step < 2; step += 1) {
    await rail.click('Jog Z- 1 mm');
    await tick(1_500);
  }
  if (zero === 'zero-z') {
    await pressZeroZ(rail);
    expect(h.simulator.state().g92?.z).not.toBe(0);
  } else {
    await plateProbe(rail, h.simulator);
  }
  expect(useLaserStore.getState().workZZeroEvidence?.toolId).toBe(SECOND);
  await act(async () => {
    await useLaserStore.getState().stopJob();
  });
  await tick(2_000);
  const capsule = await expectCapsuleFor(h.repository, runId);
  return { h, rail, capsule };
}

describe('CNC pass recovery after an Abort at a bit-change hold', () => {
  it(
    'refuses the zero the reset cleared, defaults to the new bit, and names both bits',
    async () => {
      const { h, rail, capsule } = await abortAtZeroedHold('zero-z');
      try {
        // Stock GRBL cleared the hold's G92; the work offset is the Start one.
        expect(h.simulator.state().g92 ?? { z: 0 }).toMatchObject({ z: 0 });
        expect(capsule.interruption).toMatchObject({ kind: 'cancelled', heldAtToolChange: true });

        // N5-P2-1: the default is the new bit's first pass, which was never sent.
        expect(cncPassRecoveryDefaultPoint(capsule)).toMatchObject({
          kind: 'resume-at-pass',
          groupIndex: 1,
          passIndex: 0,
        });
        const model = wizardModel(capsule);
        if (model.kind !== 'ready') throw new Error(model.reason);
        expect(model.passes.map((pass) => pass.status)).toEqual(['proven-complete', 'pending']);

        // N5-P1-1: the offset alone still matches; the cleared zero refuses it.
        const laser = useLaserStore.getState();
        expect(
          retainedPositionIssue(capsule, laser.wcoCache, laser.controllerSettings?.reportInches),
        ).toBeNull();
        expect(model.retainedPositionIssue).toContain('cleared the Zero Z (G92)');

        const sent = programLines(h.simulator, 0).length;
        const atDefault = { groupIndex: 1, passIndex: 0 };
        vi.mocked(jobAwareAlert).mockClear();
        expect(
          await drive(
            runCncPassRecoveryFlow(capsule, review('retained-confirmed', atDefault), h.repository),
          ),
        ).toBe(false);
        expect(
          await drive(
            runCncPassRecoveryFlow(capsule, review('re-zeroed', atDefault), h.repository),
          ),
        ).toBe(false);
        expect(alerts()[0]).toContain('Cannot use retained position');
        expect(alerts()[1]).toContain(`cleared the Zero Z (G92) set for ${bitName(SECOND)}`);
        expect(programLines(h.simulator, 0)).toHaveLength(sent);

        // Zeroing the bit again lets recovery run, and the plan names the bits.
        await pressZeroZ(rail);
        vi.mocked(jobAwareConfirm).mockClear();
        expect(
          await drive(
            runCncPassRecoveryFlow(capsule, review('re-zeroed', atDefault), h.repository),
          ),
        ).toBe(true);
        const plan = confirms().find((text) => text.startsWith('START CNC PASS RECOVERY?'));
        expect(plan).toContain(`Recovery starts with: ${bitName(SECOND)}`);
        expect(plan).toContain(`Bit in the spindle: ${bitName(SECOND)}`);
        expect(plan).toContain(`Z zero on record: ${bitName(SECOND)}, set by Zero Z (G92)`);
        // N5r-P3-1: the operation already cut is not a layer without toolpaths.
        expect(confirms().join('\n')).not.toContain('produced no toolpaths');
        expect(await runToHoldOrEnd()).toBe('ended');
      } finally {
        await rail.unmount();
      }
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'checks a probed hold zero the reset kept against the pass the operator picks',
    async () => {
      const { h, rail, capsule } = await abortAtZeroedHold('probe');
      try {
        expect(cncPassRecoveryDefaultPoint(capsule)).toMatchObject({ groupIndex: 1, passIndex: 0 });
        // The previous bit's pass, picked by hand, is refused before any motion.
        const sent = programLines(h.simulator, 0).length;
        vi.mocked(jobAwareAlert).mockClear();
        expect(
          await drive(
            runCncPassRecoveryFlow(
              capsule,
              review('re-zeroed', { groupIndex: 0, passIndex: 0 }),
              h.repository,
            ),
          ),
        ).toBe(false);
        expect(alerts().join('\n')).toContain(
          `starts with ${bitName(FIRST)}, but work Z was established for ${bitName(SECOND)}`,
        );
        expect(programLines(h.simulator, 0)).toHaveLength(sent);

        // The default runs on the kept probe zero, and the warning says so
        // instead of "No work zero is set".
        vi.mocked(jobAwareConfirm).mockClear();
        expect(
          await drive(
            runCncPassRecoveryFlow(
              capsule,
              review('re-zeroed', { groupIndex: 1, passIndex: 0 }),
              h.repository,
            ),
          ),
        ).toBe(true);
        const shown = confirms().join('\n');
        expect(shown).toContain(
          `kept the Z zero set by the touch-plate probe for ${bitName(SECOND)}`,
        );
        expect(shown).not.toContain('No work zero is set');
        expect(shown).toContain('kept through the controller reset');
        expect(await runToHoldOrEnd()).toBe('ended');
      } finally {
        await rail.unmount();
      }
    },
    STRESS_TIMEOUT_MS,
  );
});

/** One bit, three passes, so a cable pull lands mid-cut. */
function deepSingleBitProject(): Project {
  const project = multiBitCncProject([FIRST]);
  return {
    ...project,
    scene: {
      ...project.scene,
      layers: project.scene.layers.map((layer) =>
        layer.cnc === undefined
          ? layer
          : { ...layer, cnc: { ...layer.cnc, depthMm: 3, depthPerPassMm: 0.5 } },
      ),
    },
  };
}

describe('CNC pass recovery after a lost link (N5r-P1-1)', () => {
  it(
    'refuses "Position retained" once a reconnect shows the board may have reset',
    async () => {
      const h = await harness({
        project: deepSingleBitProject(),
        simulator: { settings: SETTINGS },
      });
      const rail = await renderRail(h.simulator);
      try {
        await probeStartZero(rail, h.simulator);
        const { runId, running } = await startFramedJob(h.repository);
        await tick(1_500);
        h.simulator.yankCable();
        await tick(20);
        await drive(running).catch(() => undefined);
        await tick(4_000);
        const saved = await expectCapsuleFor(h.repository, runId);
        expect(saved.interruption.kind).toBe('disconnect');
        // Before any reconnect nothing shows the board kept running.
        expect(wizardModel(saved)).toMatchObject({
          retainedPositionIssue: expect.stringContaining('no reconnect has shown yet'),
        });

        // The port reopens and resets the board: G54 from EEPROM, machine
        // position zero wherever the head stands, a startup banner.
        const g54 = h.simulator.state().g54;
        const fresh = createGrblSimulator({
          plannerBlocks: GRBL_PLANNER_BLOCKS,
          motionMs: 25,
          settings: SETTINGS,
          storedOffsets: g54 === null || g54 === undefined ? {} : { g54 },
        });
        await act(async () => {
          await useLaserStore.getState().connect(fresh.adapter);
        });
        await tick(3_000);
        h.simulator = fresh;
        await vi.waitFor(() =>
          expect(h.repository.getSnapshot().recoveryCapsule?.interruption.controllerRestart).toBe(
            'boot-banner',
          ),
        );
        const capsule = h.repository.getSnapshot().recoveryCapsule;
        if (capsule === null) throw new Error('Expected the saved run.');
        // The saved G54 matches the archived offset, so the offset alone passed.
        const laser = useLaserStore.getState();
        expect(
          retainedPositionIssue(
            { ...capsule, interruption: { kind: 'cancelled', message: 'x' } },
            laser.wcoCache,
            laser.controllerSettings?.reportInches,
          ),
        ).toBeNull();
        expect(wizardModel(capsule)).toMatchObject({
          retainedPositionIssue: expect.stringContaining(
            'did not show that the controller kept running',
          ),
        });
        const sent = fresh.outbound().length;
        vi.mocked(jobAwareAlert).mockClear();
        const point = cncPassRecoveryDefaultPoint(capsule);
        if (point?.kind !== 'resume-at-pass') throw new Error('Expected a pass.');
        expect(
          await drive(
            runCncPassRecoveryFlow(capsule, review('retained-confirmed', point), h.repository),
          ),
        ).toBe(false);
        expect(alerts()[0]).toContain('Cannot use retained position');
        expect(
          programLines(fresh, sent).filter((line) => /^(G0|G1|G2|G3|M3)\b/.test(line)),
        ).toEqual([]);
      } finally {
        await rail.unmount();
      }
    },
    STRESS_TIMEOUT_MS,
  );
});
