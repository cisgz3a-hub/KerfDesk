import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CompileJobModule from '../../core/job/compile-job';
import { generateFocusTest } from '../../core/job/focus-test';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { prepareOutput } from './prepare-output';
import { prepareOutputAsync } from './prepare-output-async';

const fault = vi.hoisted(() => ({ value: null as Error | null }));
vi.mock('../../core/job/compile-job', async (importOriginal) => {
  const actual = await importOriginal<typeof CompileJobModule>();
  return {
    ...actual,
    compileJob: (...args: Parameters<typeof actual.compileJob>) => {
      if (fault.value !== null) throw fault.value;
      return actual.compileJob(...args);
    },
  };
});
const project = {
  ...createProject(),
  machine: DEFAULT_CNC_MACHINE_CONFIG,
  scene: generateFocusTest({
    steps: 2,
    minOffsetMm: -1,
    maxOffsetMm: 1,
    lineLengthMm: 20,
    spacingMm: 3,
    speed: 1200,
    power: 10,
    travelFeedMmPerMin: 300,
  }),
};
const context = () => ({ jobId: 'focus-preflight-failure', runCncTasks: vi.fn(async () => []) });
afterEach(() => {
  fault.value = null;
});
describe('Focus contribution probe shares the preparation failure contract', () => {
  it('maps recognized allocation failure while validating final Focus contribution in sync and async paths', async () => {
    fault.value = new RangeError('Array buffer allocation failed');
    const sync = prepareOutput(project);
    expect(sync).toMatchObject({
      ok: false,
      preflight: { issues: [{ code: 'program-materialization-failed' }] },
    });
    const worker = context();
    expect(await prepareOutputAsync(project, {}, worker)).toEqual(sync);
    expect(worker.runCncTasks).not.toHaveBeenCalled();
  });
  it('keeps unexpected compiler errors visible rather than labelling them allocation failures', async () => {
    fault.value = new Error('Unexpected probe bug');
    expect(() => prepareOutput(project)).toThrow(fault.value);
    await expect(prepareOutputAsync(project, {}, context())).rejects.toBe(fault.value);
  });
});
