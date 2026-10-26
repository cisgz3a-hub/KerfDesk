// Laser leads beside parts the output leaves uncut (ADR-626 Amendment 10;
// meta audit v1 2026-10-23, M6-P1-1). Cut selected graphics and an operation
// with output off cut some parts now and leave the rest on the sheet for
// later. A lead must keep clear of those as it does of the parts cut with it:
// each case prepares a real project, emits GRBL and reads the burn back.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { pointInPolygon } from '../../core/geometry/point-in-polygon';
import type { JobDiagnostic } from '../../core/job/job';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type OutputScope,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { emitPreparedGcode } from './emit-gcode';
import { litSamples } from './laser-lit-samples.test-support';
import { prepareOutput, type PrepareOutputOptions } from './prepare-output';

const DEVICE = DEFAULT_DEVICE_PROFILE;
const LEADS = {
  leadInEnabled: true,
  leadOutEnabled: true,
  leadStyle: 'line',
  leadLengthMm: 2,
} as const;

function rect(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function part(id: string, points: Vec2[], operationIds: ReadonlyArray<string>): SceneObject {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    transform: IDENTITY_TRANSFORM,
    operationIds,
    paths: [{ color: '#ff0000', polylines: [{ closed: true, points }] }],
  };
}

/** A 20 mm plate A with a 20 mm neighbour `gap` mm away on each side. */
function neighbours(gap: number): Record<string, Vec2[]> {
  return {
    left: rect(80 - gap, 100, 100 - gap, 120),
    right: rect(120 + gap, 100, 140 + gap, 120),
    top: rect(100, 80 - gap, 120, 100 - gap),
    bottom: rect(100, 120 + gap, 120, 140 + gap),
  };
}

const A = rect(100, 100, 120, 120);

function layer(id: string, settings: Partial<Layer> = {}): Layer {
  return { ...createLayer({ id, color: '#ff0000', name: id }), ...settings };
}

/** A on the lead operation; the neighbours on `neighbourOperation`. */
function project(gap: number, layers: ReadonlyArray<Layer>, neighbourOperation = 'cut'): Project {
  const objects = [
    part('a', A, ['cut']),
    ...Object.entries(neighbours(gap)).map(([id, points]) =>
      part(id, points, [neighbourOperation]),
    ),
  ];
  return { ...createProject(DEVICE), scene: { layers: [...layers], objects } };
}

const SELECT_A: OutputScope = {
  cutSelectedGraphics: true,
  useSelectionOrigin: false,
  selectedObjectIds: ['a'],
};

/** Lit samples deeper than 0.05 mm inside a neighbour, and the lead
 * diagnostics, of the prepared output. */
function burn(input: Project, gap: number, options: PrepareOutputOptions = {}) {
  const prepared = prepareOutput(input, options);
  if (!prepared.ok) throw new Error('expected the project to prepare');
  const lit = litSamples(emitPreparedGcode(prepared).gcode, DEVICE, prepared.jobOriginOffset);
  const inside = Object.values(neighbours(gap)).flatMap((points) =>
    lit.filter((point) => pointInPolygon(point, points) && depth(point, points) > 0.05),
  );
  return { inside, leads: (prepared.job.diagnostics ?? []).filter(isLeadDiagnostic) };
}

function depth(point: Vec2, points: ReadonlyArray<Vec2>): number {
  const xs = points.map((corner) => corner.x);
  const ys = points.map((corner) => corner.y);
  return Math.min(
    point.x - Math.min(...xs),
    Math.max(...xs) - point.x,
    point.y - Math.min(...ys),
    Math.max(...ys) - point.y,
  );
}

function isLeadDiagnostic(diagnostic: JobDiagnostic): boolean {
  return diagnostic.kind.startsWith('laser-leads');
}

describe('M6-P1-1: leads keep clear of parts the output leaves uncut', () => {
  it('keeps every lead out of unselected neighbours 0.5 mm away under Cut selected graphics', () => {
    const input = project(0.5, [layer('cut', LEADS)]);
    const scoped = burn(input, 0.5, { outputScope: SELECT_A });
    expect(scoped.inside).toEqual([]);
    // As cutting the whole job does, Job Review says A's leads were adjusted.
    expect(scoped.leads.map((diagnostic) => diagnostic.kind)).toEqual(['laser-leads-adjusted']);
    expect(burn(input, 0.5).inside).toEqual([]);
  });

  it('keeps every lead out of neighbours on an operation with output off', () => {
    const later = layer('later', { output: false });
    const result = burn(project(0.5, [layer('cut', LEADS), later], 'later'), 0.5);
    expect(result.inside).toEqual([]);
    expect(result.leads.map((diagnostic) => diagnostic.kind)).toEqual(['laser-leads-adjusted']);
  });

  it('places the uncut parts where a placed job puts them', () => {
    // User origin at the selection's centre: the job is shifted, and the
    // neighbours must be shifted with it.
    const result = burn(project(0.5, [layer('cut', LEADS)]), 0.5, {
      outputScope: { ...SELECT_A, useSelectionOrigin: true },
      jobOrigin: { startFrom: 'user-origin', anchor: 'center' },
    });
    expect(result.inside).toEqual([]);
    expect(result.leads.map((diagnostic) => diagnostic.kind)).toEqual(['laser-leads-adjusted']);
  });

  it('leaves full leads where the uncut neighbours are far enough away', () => {
    const result = burn(project(5, [layer('cut', LEADS)]), 5, { outputScope: SELECT_A });
    expect(result.inside).toEqual([]);
    expect(result.leads).toEqual([]);
  });
});
