import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords, toSceneCoords } from '../../core/devices';
import { translateCutSegment, validCutArcMoves } from '../../core/job/cut-arc-moves';
import type { CutGroup, CutSegment, Job } from '../../core/job/job';
import { jobStartPointOptions, resolveJobStartPoint } from '../../core/job/job-start-point';
import { jobWithoutLeads } from '../../core/job/led-contours';
import { applyRotaryYScale } from '../../core/job/rotary-transform';
import {
  applyTransform,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { deserializeProject } from '../../io/project/deserialize-project';
import { serializeProject } from '../../io/project/serialize-project';
import { buildCanvasStartEditingData } from './canvas-start-editing-data';

function disc(passes = 1, overcutMm = 0, transformed = false): Project {
  const base = createProject({
    ...DEFAULT_DEVICE_PROFILE,
    controllerKind: 'grbl-v1.1',
    origin: transformed ? 'front-right' : 'rear-left',
  });
  const points = Array.from({ length: 129 }, (_, index) => ({
    x: 40 + 10 * Math.cos((index * Math.PI) / 64),
    y: 40 + 10 * Math.sin((index * Math.PI) / 64),
  }));
  return {
    ...base,
    scene: {
      ...base.scene,
      layers: [
        {
          ...createLayer({ id: 'cut', color: '#ff0000' }),
          leadInEnabled: true,
          leadOutEnabled: true,
          passes,
          overcutMm,
        },
      ],
      objects: [
        {
          kind: 'imported-svg',
          id: 'disc',
          source: 'disc.svg',
          bounds: { minX: 30, minY: 30, maxX: 50, maxY: 50 },
          transform: transformed
            ? { ...IDENTITY_TRANSFORM, x: 120, y: 80, rotationDeg: 25, mirrorX: true }
            : IDENTITY_TRANSFORM,
          paths: [{ color: '#ff0000', polylines: [{ closed: true, points }] }],
        },
      ],
    },
  };
}

function firstCut(job: Job): CutSegment {
  const segment = job.groups.find((group): group is CutGroup => group.kind === 'cut')?.segments[0];
  if (segment === undefined) throw new Error('Expected a cut');
  return segment;
}

function prepare(project: Project, offset = { x: 0, y: 0 }) {
  const result = prepareOutput(project, { absoluteProgramOffset: offset });
  if (!result.ok) throw new Error('Expected prepared output');
  return result;
}

function singleSegmentJob(segment: CutSegment): Job {
  return {
    groups: [
      {
        kind: 'cut',
        layerId: 'cut',
        color: '#ff0000',
        power: 30,
        speed: 1500,
        passes: 1,
        airAssist: false,
        segments: [segment],
      },
    ],
  };
}

describe('led native-arc cutting-start agreement', () => {
  const cases = [1, 3].flatMap((passes) =>
    [0, 1].flatMap((overcutMm) =>
      [false, true].map((transformed) => ({
        passes,
        overcutMm,
        transformed,
      })),
    ),
  );

  it.each(cases)(
    'uses the emitted contour boundaries: %j',
    ({ passes, overcutMm, transformed }) => {
      const input = disc(passes, overcutMm, transformed);
      const offset = transformed ? { x: 7, y: 9 } : { x: 0, y: 0 };
      const prepared = prepare(input, offset);
      const data = buildCanvasStartEditingData(prepared);
      const contour = firstCut(data.job);
      expect(validCutArcMoves(contour)).not.toBeNull();
      const localTarget = {
        x: 40 + 10 * Math.cos(Math.PI / 12),
        y: 40 + 10 * Math.sin(Math.PI / 12),
      };
      const object = input.scene.objects[0]!;
      const machineTarget = toMachineCoords(
        applyTransform(localTarget, object.transform),
        input.device,
      );
      const options = jobStartPointOptions(
        input.optimization,
        input.device.scanningOffsets,
        input.device,
      );
      const selected = resolveJobStartPoint(
        data.job,
        {
          x: machineTarget.x + offset.x,
          y: machineTarget.y + offset.y,
        },
        options,
      );
      expect(selected?.supported).toBe(true);
      if (selected === null) throw new Error('Expected a selected start');
      const scenePoint = toSceneCoords(
        {
          x: selected.point.x - offset.x,
          y: selected.point.y - offset.y,
        },
        input.device,
      );
      const saved = deserializeProject(
        serializeProject({ ...input, startPoints: { job: scenePoint } }),
      );
      if (saved.kind !== 'ok') throw new Error('Expected saved cutting start to round trip');
      const actual = firstCut(prepare(saved.project, offset).job);
      expect(actual.polyline[actual.leadContour!.from]?.x).toBeCloseTo(selected.point.x, 9);
      expect(actual.polyline[actual.leadContour!.from]?.y).toBeCloseTo(selected.point.y, 9);
      expect(validCutArcMoves(firstCut(jobWithoutLeads(singleSegmentJob(actual))))).not.toBeNull();
    },
  );

  it('translates retained native contour moves with the led burn', () => {
    const segment = firstCut(prepare(disc(3, 1)).job);
    const contour = firstCut(jobWithoutLeads(singleSegmentJob(segment)));
    const translated = translateCutSegment(segment, 13, -7);
    const recovered = firstCut(jobWithoutLeads(singleSegmentJob(translated)));
    expect(validCutArcMoves(recovered)).not.toBeNull();
    expect(recovered.polyline).toEqual(
      contour.polyline.map((point) => ({ x: point.x + 13, y: point.y - 7 })),
    );
  });

  it('drops retained contour arcs when rotary scaling turns them into ellipses', () => {
    const job = prepare(disc(3, 1)).job;
    const mapped = applyRotaryYScale(job, 2, true);
    const segment = firstCut(mapped);
    expect(segment.leadContour).not.toHaveProperty('arcMoves');
    const recovered = firstCut(jobWithoutLeads(mapped));
    expect(validCutArcMoves(recovered)).toBeNull();
    expect(recovered.polyline).toEqual(
      segment.polyline.slice(segment.leadContour!.from, segment.leadContour!.to + 1),
    );
  });

  it('does not trust retained arc fingerprints after an untracked contour rewrite', () => {
    const segment = firstCut(prepare(disc()).job);
    const changed = segment.polyline.map((point, index) =>
      index === segment.leadContour!.from + 1 ? { x: point.x + 1, y: point.y } : point,
    );
    const recovered = firstCut(
      jobWithoutLeads(singleSegmentJob({ ...segment, polyline: changed })),
    );
    expect(validCutArcMoves(recovered)).toBeNull();
  });
});
