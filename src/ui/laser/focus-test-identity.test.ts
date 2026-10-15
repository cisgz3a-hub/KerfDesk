import { beforeEach, describe, expect, it } from 'vitest';
import { generateFocusTest } from '../../core/job/focus-test';
import { fingerprintGcode } from '../../core/recovery';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { useStore } from '../state';
import { installFrameOnceProject } from './frame-once.test-support';
import { currentFrameSpatialSignature } from './frame-spatial-identity';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';
import { buildLaserResumeProgram } from './laser-resume-program';

beforeEach(() => {
  installFrameOnceProject();
  useStore.setState((state) => ({
    project: {
      ...state.project,
      scene: generateFocusTest({
        steps: 3,
        minOffsetMm: -1,
        maxOffsetMm: 1,
        lineLengthMm: 20,
        spacingMm: 3,
        speed: 1200,
        power: 10,
        travelFeedMmPerMin: 300,
      }),
    },
  }));
});

describe('Focus Test execution and Frame identity', () => {
  it('does not invent a starting Z datum for recovery, including replay from line one', () => {
    const project = useStore.getState().project;
    const gcode = emitGcode(project).gcode;
    const zLine = gcode.split('\n').findIndex((line) => line.includes('G1 Z')) + 1;
    expect(zLine).toBeGreaterThan(0);
    for (const line of [1, zLine, zLine + 2]) {
      expect(buildLaserResumeProgram(gcode, line, project.device)).toMatchObject({
        kind: 'error',
        reason: expect.stringContaining('original starting Z focus'),
      });
    }
    expect(
      buildLaserResumeProgram('G21\nG90\nM4 S0\nG1 X1 Y1 F300 S20\nM5', 1, project.device).kind,
    ).toBe('ok');
  });
  it('retains Frame for Z-feed-only edits but changes execution identity and emitted bytes', () => {
    const spatial = currentFrameSpatialSignature();
    const execution = currentReplayExecutionSignature();
    const bytes = fingerprintGcode(emitGcode(useStore.getState().project).gcode);
    useStore
      .getState()
      .setLayerParam('focus-test-1', { focusTest: { offsetMm: -1, travelFeedMmPerMin: 450 } });
    expect(currentFrameSpatialSignature()).toBe(spatial);
    expect(currentReplayExecutionSignature()).not.toBe(execution);
    expect(fingerprintGcode(emitGcode(useStore.getState().project).gcode)).not.toEqual(bytes);
  });
  it('invalidates Frame and execution identity when the Z offset changes', () => {
    const spatial = currentFrameSpatialSignature();
    const execution = currentReplayExecutionSignature();
    useStore
      .getState()
      .setLayerParam('focus-test-1', { focusTest: { offsetMm: -2, travelFeedMmPerMin: 300 } });
    expect(currentFrameSpatialSignature()).not.toBe(spatial);
    expect(currentReplayExecutionSignature()).not.toBe(execution);
  });
  it('settings paste preserves each sample offset instead of copying Z intent', () => {
    useStore.getState().setLayerParam('focus-test-1', { speed: 777 });
    useStore.getState().copyLayerSettings('focus-test-1');
    useStore.getState().pasteLayerSettings('focus-test-3');
    const target = useStore
      .getState()
      .project.scene.layers.find((layer) => layer.id === 'focus-test-3');
    expect(target?.speed).toBe(777);
    expect(target?.focusTest).toEqual({ offsetMm: 1, travelFeedMmPerMin: 300 });
    useStore.getState().undo();
    expect(
      useStore.getState().project.scene.layers.find((layer) => layer.id === 'focus-test-3')?.speed,
    ).toBe(1200);
  });
});
