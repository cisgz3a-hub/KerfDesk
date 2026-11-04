// ADR-598 Amendment 4: a Start preparation crosses the worker boundary with its
// scene as indices and its fill segments as columns. The window must end up
// with exactly what a plain structured clone gave it, and the same bytes.
import { describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { analyzeFillHeatRisk } from '../../core/job';
import { DEFAULT_OUTPUT_SCOPE, type Project } from '../../core/scene';
import { emitPreparedGcode } from '../../io/gcode';
import { hydratePreparedExecutionOutput } from '../../io/gcode/prepared-output-persistence';
import { DEFAULT_JOB_PLACEMENT } from '../job-placement';
import { packProjectMessage, unpackProjectMessage } from '../packed-project-transfer';
import { memoizedFillHeatRisk } from './job-review/fill-heat-risk-memo';
import { measureProgramFacts, programFactsOf } from './job-review/program-facts';
import { hydrateTransferredStartPreparation } from './output-preparation-worker-client';
import { prepareOutputRequest } from './output-preparation';
import { fillProject, streamedProject } from './output-preparation-fixtures.test-support';
import type { TransferredStartJobPreparation } from './output-preparation-protocol';
import {
  packStartPreparationForWire,
  unpackStartPreparationFromWire,
  type StartPreparationWire,
} from './start-preparation-wire';

const IDLE: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: { x: 0, y: 0, z: 0 },
  feed: 0,
  spindle: 0,
  wco: null,
};

/** What the worker builds from its own unpacked copy of `project`. */
async function workerStart(project: Project) {
  const workerProject = unpackProjectMessage(packProjectMessage(project).message);
  const response = await prepareOutputRequest({
    kind: 'start',
    project: workerProject,
    controllerSettings: null,
    machine: { statusReport: IDLE, alarmCode: null, hasActiveStreamer: false },
    jobPlacement: DEFAULT_JOB_PLACEMENT,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    requireFrame: false,
  });
  if (response.kind !== 'start' || 'wire' in response.result || !response.result.ok)
    throw new Error('Start did not prepare.');
  return { workerProject, result: response.result };
}

function overTheBoundary(message: StartPreparationWire, transfer: ArrayBuffer[]) {
  return structuredClone(message, { transfer });
}

describe('Start preparation over the worker boundary', () => {
  it.each([
    ['a Fill job', fillProject],
    ['a streamed photo', streamedProject],
  ])('restores exactly what a plain clone gave the window for %s', async (_name, make) => {
    const project = make();
    const { workerProject, result } = await workerStart(project);
    const plain = structuredClone(result);
    const wire = packStartPreparationForWire(result, workerProject);
    const restored = await unpackStartPreparationFromWire(
      overTheBoundary(wire.message, wire.transfer),
      project,
    );
    expect(restored).toEqual(plain);
    // Same keys in the same order, at every level.
    expect(JSON.stringify(restored)).toBe(JSON.stringify(plain));
    if (!restored.ok) throw new Error('Start did not prepare.');
    // The window's own scene objects, not copies of them.
    restored.prepared.project.scene.objects.forEach((object, index) =>
      expect(object).toBe(project.scene.objects[index]),
    );
    // And the burn: the restored job emits the program the worker emitted.
    const sealed = hydratePreparedExecutionOutput(restored.prepared) ?? restored.prepared;
    expect(emitPreparedGcode(sealed, { outputScope: DEFAULT_OUTPUT_SCOPE }).gcode).toBe(
      emitPreparedGcode(hydratePreparedExecutionOutput(plain.prepared as never) ?? plain.prepared, {
        outputScope: DEFAULT_OUTPUT_SCOPE,
      }).gcode,
    );
  });

  it('sends plain fill segments as columns and the scene as indices', async () => {
    const project = fillProject();
    const { workerProject, result } = await workerStart(project);
    const { message, transfer } = packStartPreparationForWire(result, workerProject);
    if (!('wire' in message)) throw new Error('Start did not pack.');
    const fills = message.result.prepared.job.groups.filter((group) => group.kind === 'fill');
    expect(fills.length).toBeGreaterThan(0);
    for (const group of fills) expect('packedSegments' in group).toBe(true);
    expect(Array.from(message.result.prepared.project.scene.objectIndices)).toEqual(
      project.scene.objects.map((_object, index) => index),
    );
    expect(message.result.prepared.project.scene.ownObjects).toEqual([]);
    expect(transfer.length).toBeGreaterThan(0);
  });

  it('keeps a segment of any other shape, and an object the worker made, whole', async () => {
    const project = fillProject();
    const { workerProject, result } = await workerStart(project);
    const fill = result.prepared.job.groups.find((group) => group.kind === 'fill');
    if (fill?.kind !== 'fill') throw new Error('No fill group.');
    const unusual = {
      ...fill,
      segments: [{ ...fill.segments[0]!, nesting: { forest: 'f', depth: 0 } }],
    };
    const madeHere = { ...workerProject.scene.objects[0]!, id: 'made-in-worker' };
    const changed: TransferredStartJobPreparation = {
      ...result,
      prepared: {
        ...result.prepared,
        project: {
          ...result.prepared.project,
          scene: { ...result.prepared.project.scene, objects: [madeHere] },
        },
        job: { ...result.prepared.job, groups: [unusual] },
      },
    };
    const wire = packStartPreparationForWire(changed, workerProject);
    if (!('wire' in wire.message)) throw new Error('Start did not pack.');
    expect('packedSegments' in wire.message.result.prepared.job.groups[0]!).toBe(false);
    const restored = await unpackStartPreparationFromWire(
      overTheBoundary(wire.message, wire.transfer),
      project,
    );
    expect(JSON.stringify(restored)).toBe(JSON.stringify(changed));
  });

  it('seeds the Job Review fill analysis the worker already made', async () => {
    const project = fillProject();
    const { workerProject, result } = await workerStart(project);
    const wire = packStartPreparationForWire(result, workerProject);
    const received = overTheBoundary(wire.message, wire.transfer);
    if (!('wire' in received)) throw new Error('Start did not pack.');
    const restored = await unpackStartPreparationFromWire(received, project);
    if (!restored.ok) throw new Error('Start did not prepare.');
    // The analysis that arrived, not one replanned on the window.
    expect(memoizedFillHeatRisk(restored.prepared.job, project.device.scanningOffsets)).toBe(
      received.fillHeatRisk.risk,
    );
    expect(received.fillHeatRisk.risk).toEqual(
      analyzeFillHeatRisk(restored.prepared.job, project.device.scanningOffsets),
    );
  });

  it('hands Job Review the program facts the worker measured, for this program only', async () => {
    const project = fillProject();
    const { workerProject, result } = await workerStart(project);
    const wire = packStartPreparationForWire(result, workerProject);
    const received = overTheBoundary(wire.message, wire.transfer);
    if (!('wire' in received)) throw new Error('Start did not pack.');
    const hydrated = hydrateTransferredStartPreparation(
      await unpackStartPreparationFromWire(received, project),
    );
    if (!hydrated.ok) throw new Error('Start did not prepare.');
    expect(programFactsOf(hydrated)).toBe(received.programFacts);
    expect(received.programFacts).toEqual(measureProgramFacts(hydrated.gcode));
    // A copy with other bytes measures its own.
    const edited = {
      ...hydrated,
      gcode: `${hydrated.gcode}M7
`,
    };
    expect(programFactsOf(edited).usesM7).toBe(true);
    expect(programFactsOf(hydrated).usesM7).toBe(false);
  });

  it('stops rebuilding when its preparation is cancelled between slices', async () => {
    const project = fillProject();
    const { workerProject, result } = await workerStart(project);
    const wire = packStartPreparationForWire(result, workerProject);
    const controller = new AbortController();
    let clock = 0;
    // Every slice is "over budget", so the rebuild yields at its first check.
    const now = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 1000));
    const pending = unpackStartPreparationFromWire(
      overTheBoundary(wire.message, wire.transfer),
      project,
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    now.mockRestore();
  });
});
