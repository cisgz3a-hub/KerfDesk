// ADR-244 Amendment 3: Start and Frame keep the motion manifest in columns,
// and Job Review checks the Frame against the bounds the worker measured.
import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import { emitPreparedGcode } from '../../io/gcode';
import { hydratePreparedExecutionOutput } from '../../io/gcode/prepared-output-persistence';
import { DEFAULT_JOB_PLACEMENT } from '../job-placement';
import { frameVerificationForProject } from './frame-verification-testing';
import { prepareOutputRequest } from './output-preparation';
import { fillProject, streamedProject } from './output-preparation-fixtures.test-support';
import { hydrateTransferredStartPreparation } from './output-preparation-worker-client';
import {
  preparedStartFrameBounds,
  requiredFrameIssueFromPrepared,
} from './required-frame-readiness';

const IDLE: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: { x: 0, y: 0, z: 0 },
  feed: 0,
  spindle: 0,
  wco: null,
};

describe('Start preparation in columns', () => {
  // ADR-244 Amendment 3 moved the manifest into columns and the program's line
  // scans off split('\n'); neither may change a byte or a block.
  it.each([
    ['a streamed photo', streamedProject],
    ['a Fill job', fillProject],
  ])('emits the bytes Save writes for %s and hands its motion over intact', async (_name, make) => {
    const project = make();
    const response = await prepareOutputRequest({
      kind: 'start',
      project,
      controllerSettings: null,
      machine: { statusReport: IDLE, alarmCode: null, hasActiveStreamer: false },
      jobPlacement: DEFAULT_JOB_PLACEMENT,
      outputScope: DEFAULT_OUTPUT_SCOPE,
      requireFrame: false,
    });
    if (response.kind !== 'start' || !response.result.ok) throw new Error('Start did not prepare.');
    const sealed = hydratePreparedExecutionOutput(response.result.prepared);
    expect(
      emitPreparedGcode(sealed ?? response.result.prepared, { outputScope: DEFAULT_OUTPUT_SCOPE })
        .gcode,
    ).toBe(response.result.gcode);
    // Past 4,096 blocks the plan crosses as packed columns.
    expect('encoding' in response.result.canvasPlan.manifest).toBe(true);
    const received = hydrateTransferredStartPreparation(structuredClone(response.result));
    if (!received.ok) throw new Error('Start did not hydrate.');
    const parsed = buildMotionManifest(response.result.gcode, {
      machineKind: 'laser',
      initialPosition: { x: 0, y: 0, z: 0 },
    });
    expect(Array.from(received.canvasPlan.manifest.blocks)).toEqual(Array.from(parsed.blocks));
    expect(parsed.blocks.length).toBeGreaterThan(4_096);
  });

  // The bed-sized photo of performance audit S4 (S4-P2-2): its Start review
  // revoked the Frame it had just matched, because the window measured a job
  // whose streamed rows had stayed in the worker.
  it('passes the frame-first gate of a streamed image with the bounds the worker measured', async () => {
    const project = streamedProject();
    const response = await prepareOutputRequest({
      kind: 'start',
      project,
      controllerSettings: null,
      machine: {
        statusReport: IDLE,
        alarmCode: null,
        hasActiveStreamer: false,
        settingsCapability: 'none',
      },
      jobPlacement: DEFAULT_JOB_PLACEMENT,
      outputScope: DEFAULT_OUTPUT_SCOPE,
      requireFrame: false,
    });
    if (response.kind !== 'start' || !response.result.ok) throw new Error('Start did not prepare.');
    const hydrated = hydrateTransferredStartPreparation(response.result);
    if (!hydrated.ok) throw new Error('Start did not hydrate.');
    const machine = { frameVerification: frameVerificationForProject(project) };

    // Measured again on this side, the image has no rows and no bounds.
    expect(requiredFrameIssueFromPrepared({ prepared: hydrated.prepared, machine })).not.toBeNull();
    expect(
      requiredFrameIssueFromPrepared({
        prepared: hydrated.prepared,
        machine,
        measuredFrameBounds: preparedStartFrameBounds(hydrated),
      }),
    ).toBeNull();
  });
});
