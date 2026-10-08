import { projectWithLine } from '../../../__fixtures__/file-actions';
import { describe, it, expect } from 'vitest';
import type { CncGroup, Job } from '../../job/job';
import { DEFAULT_CNC_WRAP_STUDY } from '../../scene/cnc-wrap-study';
import {
  mapCncWrapPoint,
  planCncWrapReference,
  cncWrapSegmentLength,
} from './cnc-wrap-reference-plan';
import { cncWrapReferenceProgram } from './cnc-wrap-reference-program';
import { cncWrapOutputAvailability } from './cnc-wrap-capabilities';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../scene';
import { defaultCncMachiningSetup } from '../../scene/cnc-machining-setup';
import { emitGcode } from '../../../io/gcode';
import { deserializeProject, serializeProject } from '../../../io/project';
const group: CncGroup = {
  kind: 'cnc',
  layerId: 'path',
  color: '#000000',
  cutType: 'profile-on-path',
  toolId: 'end3',
  toolName: 'End 3',
  toolKind: 'end-mill',
  toolDiameterMm: 3,
  feedMmPerMin: 100,
  plungeMmPerMin: 25,
  spindleRpm: 9000,
  spindleSpinupSec: 1,
  safeZMm: 5,
  passes: [
    {
      kind: 'contour',
      polyline: [
        { x: 4, y: 0 },
        { x: 4, y: Math.PI * 50 },
      ],
      zMm: -1,
      closed: false,
    },
  ],
};
const job = (groups: readonly CncGroup[] = [group]): Job => ({ groups });
describe('CNC wrap capability reference', () => {
  it('maps independent cylinder circumference, direction and datum without discontinuous seam shortcuts', () => {
    const setup = {
      ...DEFAULT_CNC_WRAP_STUDY,
      radiusMm: 25,
      seamMm: 3,
      rotaryDatumDeg: 15,
      axialDatumMm: 2,
      direction: -1 as const,
    };
    const point = mapCncWrapPoint({ x: 7, y: 3 + Math.PI * 25, z: -1 }, setup);
    expect(point.axialMm).toBe(9);
    expect(point.angleDeg).toBeCloseTo(-165, 9);
    expect(point.radialZMm).toBe(-1);
    const xAxis = mapCncWrapPoint(
      { x: Math.PI * 20, y: 8, z: -2 },
      { ...DEFAULT_CNC_WRAP_STUDY, radiusMm: 10, circumferentialAxis: 'x' },
    );
    expect(xAxis).toMatchObject({ axialMm: 8, radialZMm: -2 });
    expect(xAxis.angleDeg).toBeCloseTo(360, 9);
  });
  it('uses per-block inverse minutes at the represented cutting radius and restores G94 before travel/holds', () => {
    const result = planCncWrapReference(job(), DEFAULT_CNC_WRAP_STUDY);
    if (result.kind !== 'ok') throw new Error(result.reason);
    const program = cncWrapReferenceProgram(result.plan);
    const cut = program.split('\n').find((line) => line.startsWith('G1 X4 A360'));
    expect(cut).toBeDefined();
    const feed = Number(cut?.match(/F([0-9.]+)/)?.[1]);
    // One revolution of a radius 24 mm cutter-tip locus at 100 mm/min.
    expect(1 / feed).toBeCloseTo((2 * Math.PI * 24) / 100, 5);
    expect(program).toContain('G1 Z-1 F25\nG93');
    expect(program).toMatch(/G94\nG0 Z5\nM5\nM2\n$/);
    const multi = planCncWrapReference(
      job([group, { ...group, toolId: 'end2', toolName: 'Second' }]),
      DEFAULT_CNC_WRAP_STUDY,
    );
    if (multi.kind !== 'ok') throw new Error(multi.reason);
    const bytes = cncWrapReferenceProgram(multi.plan);
    expect(bytes.split('\n').filter((line) => line === 'M0')).toHaveLength(2);
    expect(bytes).not.toContain('M6');
  });
  it('uses conservative radial metric and descent rate for changing depth', () => {
    expect(
      cncWrapSegmentLength(
        { axialMm: 0, angleDeg: 0, radialZMm: 0 },
        { axialMm: 0, angleDeg: 180, radialZMm: -3 },
        10,
      ),
    ).toBeCloseTo(Math.hypot(Math.PI * 10, 3), 10);
  });
  it('keeps unknown posts, unsupported geometry and unqualified machine output unavailable', () => {
    expect(cncWrapOutputAvailability('grbl-3-axis')).toMatchObject({ available: false });
    expect(cncWrapOutputAvailability(DEFAULT_CNC_WRAP_STUDY.capabilityId)).toMatchObject({
      available: false,
    });
    expect(
      planCncWrapReference(job([{ ...group, cutType: 'pocket' }]), DEFAULT_CNC_WRAP_STUDY).kind,
    ).toBe('unavailable');
    expect(
      planCncWrapReference(
        job([
          {
            ...group,
            passes: [
              {
                kind: 'arc',
                start: { x: 1, y: 0 },
                end: { x: 1, y: 0 },
                center: { x: 0, y: 0 },
                clockwise: false,
                zMm: -1,
                closed: true,
              },
            ],
          },
        ]),
        DEFAULT_CNC_WRAP_STUDY,
      ).kind,
    ).toBe('unavailable');
    expect(
      planCncWrapReference(
        job([
          {
            ...group,
            passes: [
              {
                kind: 'contour',
                polyline: [
                  { x: 0, y: 0 },
                  { x: 1, y: 2 },
                ],
                zMm: -25,
                closed: false,
              },
            ],
          },
        ]),
        DEFAULT_CNC_WRAP_STUDY,
      ).kind,
    ).toBe('unavailable');
  });
  it('closes every closed contour at its declared depth before the safe retract', () => {
    const result = planCncWrapReference(
      job([
        {
          ...group,
          passes: [
            {
              kind: 'contour',
              zMm: -1,
              closed: true,
              polyline: [
                { x: 4, y: 0 },
                { x: 8, y: 0 },
                { x: 8, y: 2 },
              ],
            },
          ],
        },
      ]),
      DEFAULT_CNC_WRAP_STUDY,
    );
    if (result.kind !== 'ok') throw new Error(result.reason);
    const points = result.plan.paths[0]?.points;
    expect(points).toHaveLength(4);
    expect(points?.at(-1)).toEqual(points?.[0]);
    const program = cncWrapReferenceProgram(result.plan);
    expect(program).toMatch(/G1 X4 A0 Z-1 F[0-9.]+\nG94\nG0 Z5/);
  });
  it('rejects malformed scalar input and overflowed mapped coordinates without partial paths', () => {
    for (const radiusMm of [0, -1, Infinity, NaN, 100_001]) {
      expect(planCncWrapReference(job(), { ...DEFAULT_CNC_WRAP_STUDY, radiusMm }).kind).toBe(
        'unavailable',
      );
    }
    expect(planCncWrapReference(job(), { ...DEFAULT_CNC_WRAP_STUDY, seamMm: Infinity }).kind).toBe(
      'unavailable',
    );
    expect(
      planCncWrapReference(
        job([
          {
            ...group,
            passes: [
              {
                kind: 'contour',
                zMm: 0,
                closed: false,
                polyline: [
                  { x: 0, y: 0 },
                  { x: 0, y: 1_000_000 },
                ],
              },
            ],
          },
        ]),
        { ...DEFAULT_CNC_WRAP_STUDY, radiusMm: Number.MIN_VALUE },
      ).kind,
    ).toBe('unavailable');
  });
  it('retains setup study intent without changing ordinary emitted CNC bytes', () => {
    const project = { ...projectWithLine(), machine: DEFAULT_CNC_MACHINE_CONFIG };
    const study = {
      ...project,
      cncSetup: { ...defaultCncMachiningSetup(), wrapStudy: DEFAULT_CNC_WRAP_STUDY },
    };
    const reopened = deserializeProject(serializeProject(study));
    expect(reopened.kind).toBe('ok');
    if (reopened.kind !== 'ok') throw new Error(JSON.stringify(reopened));
    expect(reopened.project.cncSetup?.wrapStudy).toEqual(DEFAULT_CNC_WRAP_STUDY);
    expect(emitGcode(reopened.project).gcode).toBe(emitGcode(project).gcode);
  });
});
