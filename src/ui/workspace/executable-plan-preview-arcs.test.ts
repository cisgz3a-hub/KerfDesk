// ADR-432: a job whose contours go out as G2/G3 keeps the prepared preview
// route, which draws the arcs, and never pays for a plan route it would throw
// away: the v1 plan draws arcs with the display parser's chords, so the two
// routes cannot agree at emitted precision.

import { describe, expect, it, vi } from 'vitest';
import { projectWithLine } from '../../__fixtures__/file-actions';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { CutSegment, Job } from '../../core/job';
import { buildToolpath } from '../../core/job';
import { withCutArcMoves } from '../../core/job/cut-arc-moves';
import { createProject } from '../../core/scene';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import * as executablePlan from '../../io/gcode/executable-plan';
import { buildPreviewToolpathFromPrepared } from './draw-preview';
import { planPreviewRouteEligible, previewRouteSource } from './executable-plan-preview-route';

const PLAIN: CutSegment = {
  polyline: Array.from({ length: 17 }, (_, step) => {
    const angle = Math.PI - (step * Math.PI) / 16;
    return { x: 20 + 10 * Math.cos(angle), y: 20 + 10 * Math.sin(angle) };
  }),
  closed: false,
};
const LAST = PLAIN.polyline[16] as { x: number; y: number };
const ARCS = withCutArcMoves(PLAIN, [
  { kind: 'arc', to: { x: 20, y: 30 }, center: { x: 20, y: 20 }, clockwise: true },
  { kind: 'arc', to: LAST, center: { x: 20, y: 20 }, clockwise: true },
]);

function jobWith(segment: CutSegment, entryRunwayMm?: number): Job {
  return {
    groups: [
      {
        kind: 'cut',
        layerId: 'l',
        color: '#000000',
        power: 30,
        speed: 1500,
        passes: 1,
        airAssist: false,
        segments: [segment],
        ...(entryRunwayMm === undefined ? {} : { entryRunwayMm }),
      },
    ],
  };
}

function prepared(job: Job) {
  return {
    ok: true as const,
    project: createProject({ ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grbl-v1.1' }),
    job,
    jobOriginOffset: { x: 0, y: 0 },
  };
}

describe('preview route for arc jobs (ADR-432)', () => {
  it('keeps the prepared route for a job that writes arcs', () => {
    expect(ARCS.arcMoves).toBeDefined();
    const job = jobWith(ARCS);
    expect(planPreviewRouteEligible({ prepared: prepared(job), route: buildToolpath(job) })).toBe(
      false,
    );
    const project = createProject();
    const preview = buildPreviewToolpathFromPrepared(project, prepared(job), undefined, {
      executablePlan: true,
    });
    expect(previewRouteSource(preview)).toBe('legacy-toolpath');
  });

  it('still offers the plan route where the same contour goes out as G1', () => {
    for (const job of [jobWith(PLAIN), jobWith(ARCS, 2)]) {
      expect(planPreviewRouteEligible({ prepared: prepared(job), route: buildToolpath(job) })).toBe(
        true,
      );
    }
  });

  it('rejects native arcs before reading a supplied worker program or emitting a sidecar', () => {
    const ready = prepared(jobWith(ARCS));
    const expected = buildPreviewToolpathFromPrepared(ready.project, ready);
    const program = emitPreparedGcode(ready).gcode;
    expect(program).toMatch(/\bG[23]\b/);
    const emit = vi.spyOn(executablePlan, 'emitPreparedGcodeWithExecutablePlan');
    const sidecar = vi.spyOn(executablePlan, 'buildExecutablePlanSidecar');
    try {
      const preview = buildPreviewToolpathFromPrepared(ready.project, ready, undefined, {
        executablePlan: true,
        emittedProgram: program,
        allowPlanEmission: false,
      });
      expect(previewRouteSource(preview)).toBe('legacy-toolpath');
      expect(preview).toEqual(expected);
      expect(sidecar).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    } finally {
      sidecar.mockRestore();
      emit.mockRestore();
    }
  });

  it('reuses a supplied G1 worker program while optional re-emission is disabled', () => {
    const project = projectWithLine();
    const ready = prepareOutput(project);
    if (!ready.ok) throw new Error('Line fixture did not prepare');
    const program = emitPreparedGcode(ready).gcode;
    const emit = vi.spyOn(executablePlan, 'emitPreparedGcodeWithExecutablePlan');
    const sidecar = vi.spyOn(executablePlan, 'buildExecutablePlanSidecar');
    try {
      const preview = buildPreviewToolpathFromPrepared(project, ready, undefined, {
        executablePlan: true,
        emittedProgram: program,
        allowPlanEmission: false,
      });
      expect(previewRouteSource(preview)).toBe('executable-plan');
      expect(sidecar).toHaveBeenCalledExactlyOnceWith(program, ready.project);
      expect(emit).not.toHaveBeenCalled();
    } finally {
      sidecar.mockRestore();
      emit.mockRestore();
    }
  });
});
