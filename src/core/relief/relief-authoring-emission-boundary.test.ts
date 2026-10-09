import { describe, expect, it } from 'vitest';
import { createBlankReliefAuthoringDocument } from './relief-authoring-document';
import { materializeReliefAuthoring } from './materialize-relief-authoring';
import { decodeCanonicalBase64 } from './depth-map-base64';
import {
  createProject,
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Transform,
  type Vec2,
} from '../scene';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { ReliefAuthoringDocument } from '../scene/relief/relief-authoring';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { cncGrblStrategy } from '../output';

const rectangle = (low: number, high: number) => ({
  closed: true,
  points: [
    { x: low, y: low },
    { x: high, y: low },
    { x: high, y: high },
    { x: low, y: high },
  ],
});
function document(): ReliefAuthoringDocument {
  return {
    ...createBlankReliefAuthoringDocument({
      width: 10,
      height: 10,
      physicalWidthMm: 10,
      physicalHeightMm: 10,
      maxDepthMm: 1,
    }),
    outsideMask: 'excluded',
    clip: { rings: [rectangle(2.2, 7.8)] },
    components: [
      {
        id: 'plane',
        name: 'Plane',
        levelId: 'level-1',
        visible: true,
        combineMode: 'replace',
        transform: IDENTITY_TRANSFORM,
        baseHeightMm: 0,
        heightScale: 1,
        source: {
          kind: 'vector-shape-v1',
          boundary: { rings: [rectangle(0, 10)] },
          profile: 'plane',
          heightMm: 0,
          angleDeg: 0,
        },
      },
    ],
  };
}
function placed(p: Vec2, t: Transform): Vec2 {
  const x = p.x * t.scaleX * (t.mirrorX ? -1 : 1),
    y = p.y * t.scaleY * (t.mirrorY ? -1 : 1),
    angle = (t.rotationDeg * Math.PI) / 180;
  return {
    x: t.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: t.y + x * Math.sin(angle) + y * Math.cos(angle),
  };
}
function insideMargin(p: Vec2, polygon: readonly Vec2[]): number {
  const centre = {
    x: polygon.reduce((s, v) => s + v.x, 0) / 4,
    y: polygon.reduce((s, v) => s + v.y, 0) / 4,
  };
  let margin = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!,
      b = polygon[(i + 1) % polygon.length]!;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const sign = Math.sign(dx * (centre.y - a.y) - dy * (centre.x - a.x));
    margin = Math.min(
      margin,
      (sign * (dx * (p.y - a.y) - dy * (p.x - a.x))) / Math.hypot(dx, dy) - 0.5,
    );
  }
  return margin;
}
function belowTopVertices(gcode: string): Array<Vec2 & { z: number }> {
  let position = { x: NaN, y: NaN, z: NaN };
  let mode: string | undefined;
  const vertices: Array<Vec2 & { z: number }> = [];
  for (const line of gcode.split(/\r?\n/u)) {
    const motion = /^G([01])(?=[^0-9]|$)/u.exec(line);
    if (motion !== null) mode = motion[1];
    else if (/^G/u.test(line)) continue;
    if (!/[XYZ][-+0-9]/u.test(line)) continue;
    const next = { ...position };
    for (const axis of ['x', 'y', 'z'] as const) {
      const value = new RegExp(axis.toUpperCase() + '(-?\\d+(?:\\.\\d+)?)', 'u').exec(line)?.[1];
      if (value !== undefined) next[axis] = Number(value);
    }
    if (mode === '1' && next.z < 0 && Number.isFinite(next.x) && Number.isFinite(next.y))
      vertices.push(next);
    position = next;
  }
  return vertices;
}
describe('authored relief clip at executable cutter contact', () => {
  it.each([
    { ...IDENTITY_TRANSFORM },
    { ...IDENTITY_TRANSFORM, x: 40, y: 30, rotationDeg: 37 },
    {
      ...IDENTITY_TRANSFORM,
      x: 50,
      y: 30,
      rotationDeg: -23,
      mirrorX: true,
      scaleX: 2,
      scaleY: 0.6,
    },
  ])(
    'keeps the physical cutter inside a fractional vector clip under $rotationDeg degree placement',
    (transform) => {
      const doc = document(),
        field = materializeReliefAuthoring(doc);
      if (field.kind !== 'ok') throw new Error('Materialization failed.');
      const color = '#000000',
        tool = { id: 'flat', name: 'Flat', kind: 'end-mill' as const, diameterMm: 1 };
      const project = {
        ...createProject(),
        device: { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' as const },
        machine: { ...DEFAULT_CNC_MACHINE_CONFIG, toolId: tool.id, tools: [tool] },
        scene: {
          objects: [
            {
              kind: 'relief' as const,
              id: 'relief',
              source: 'fractional vector clip',
              color,
              operationIds: ['op'],
              transform,
              bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
              targetWidthMm: 10,
              reliefDepthMm: 1,
              reliefSource: field.field,
              reliefAuthoring: doc,
            },
          ],
          layers: [
            {
              ...createLayer({ id: 'op', color }),
              cnc: {
                ...DEFAULT_CNC_LAYER_SETTINGS,
                cutType: 'pocket' as const,
                toolId: tool.id,
                reliefFinishToolId: tool.id,
                depthPerPassMm: 1,
                finishAllowanceMm: 0,
                reliefScallopMm: 0.1,
              },
            },
          ],
        },
      };
      const prepared = prepareOutput(project);
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) throw new Error('Preparation failed.');
      const vertices = belowTopVertices(cncGrblStrategy.emit(prepared.job, project.device));
      expect(vertices.length).toBeGreaterThan(0);
      const boundary = rectangle(2.2, 7.8).points.map((p) => placed(p, transform));
      // A convex polygon contains a swept disk along each straight move whenever
      // it contains that disk at both endpoints. This also checks cutter reach.
      for (const vertex of vertices)
        expect(insideMargin(vertex, boundary)).toBeGreaterThanOrEqual(-1e-9);
    },
  );
  it('keeps admitted finite physical extents finite instead of silently losing columns', () => {
    const { clip: _clip, ...doc } = document();
    const huge: ReliefAuthoringDocument = {
      ...doc,
      width: 4,
      height: 1,
      physicalWidthMm: 1e308,
      maxDepthMm: 10,
      components: doc.components.map((c) => ({
        ...c,
        source: {
          kind: 'vector-shape-v1',
          profile: 'plane',
          heightMm: 2,
          angleDeg: 0,
          boundary: {
            rings: [
              {
                closed: true,
                points: [
                  { x: 0, y: 0 },
                  { x: 1e308, y: 0 },
                  { x: 1e308, y: 10 },
                  { x: 0, y: 10 },
                ],
              },
            ],
          },
        },
      })),
    };
    const field = materializeReliefAuthoring(huge);
    expect(field.kind).toBe('ok');
    if (field.kind !== 'ok') throw new Error('Finite field failed.');
    const decoded = decodeCanonicalBase64(field.field.samplesBase64);
    if (decoded.kind !== 'ok') throw new Error('Finite field payload failed.');
    const bytes = decoded.bytes;
    for (let i = 0; i < 4; i++) expect(bytes[2 * i]! | (bytes[2 * i + 1]! << 8)).toBe(13107);
  });
});
