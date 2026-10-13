import { beforeEach, describe, expect, it } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { createProject } from '../../core/scene';
import type { FramedRunCandidate } from './framed-run';
import { buildFrameDispatchPlan } from './laser-frame-motion-plan';
import { useLaserStore, type LiveRefs } from './laser-store';
import { useStore } from './store';

const bounds = { minX: 0, minY: 0, maxX: 20, maxY: 10 };
const refs = { driver: grblDriver } as LiveRefs;

function candidate(returnToWorkPosition: { x: number; y: number }): FramedRunCandidate {
  return {
    project: { ...createProject(), startPoints: { frame: { edge: 2, fraction: 0.25 } } },
    returnToWorkPosition,
  } as FramedRunCandidate;
}

describe('Frame dispatch with a chosen perimeter start', () => {
  beforeEach(() => {
    useStore.setState({ project: createProject() });
  });

  it('takes a recovery Frame selection from its saved project instead of the open canvas', () => {
    const savedProject = candidate({ x: 0, y: 0 }).project;
    const plan = buildFrameDispatchPlan(
      refs,
      useLaserStore.getState,
      bounds,
      6000,
      undefined,
      savedProject,
    );
    expect(plan.kind).toBe('ready');
    if (plan.kind !== 'ready') return;
    expect(plan.lines[grblDriver.commands.frameToolOffLines.length]).toBe(
      '$J=G90 G21 X15.000 Y10.000 F6000\n',
    );
    expect(plan.lines.at(-1)).toBe('$J=G90 G21 X15.000 Y10.000 F6000\n');
  });

  it('uses the immutable candidate selection and returns to the pre-Frame position', () => {
    const plan = buildFrameDispatchPlan(
      refs,
      useLaserStore.getState,
      bounds,
      6000,
      candidate({ x: 0, y: 0 }),
    );
    expect(plan.kind).toBe('ready');
    if (plan.kind !== 'ready') return;
    expect(plan.lines.slice(0, grblDriver.commands.frameToolOffLines.length)).toEqual(
      grblDriver.commands.frameToolOffLines.map((line) => `${line}\n`),
    );
    expect(plan.lines[grblDriver.commands.frameToolOffLines.length]).toBe(
      '$J=G90 G21 X15.000 Y10.000 F6000\n',
    );
    expect(plan.lines.at(-2)).toBe('$J=G90 G21 X15.000 Y10.000 F6000\n');
    expect(plan.lines.at(-1)).toBe('$J=G90 G21 X0.000 Y0.000 F6000\n');
  });

  it('omits the return leg only when the chosen start is the original position', () => {
    const plan = buildFrameDispatchPlan(
      refs,
      useLaserStore.getState,
      bounds,
      6000,
      candidate({ x: 15, y: 10 }),
    );
    expect(plan.kind).toBe('ready');
    if (plan.kind !== 'ready') return;
    expect(plan.lines).toHaveLength(grblDriver.commands.frameToolOffLines.length + 6);
    expect(plan.lines.at(-1)).toBe('$J=G90 G21 X15.000 Y10.000 F6000\n');
  });
});
