import { describe, expect, it } from 'vitest';
import { createPolyline, polylineToPolylines } from '../../core/shapes';
import {
  createLayer,
  createProject,
  polylineToCurveSubpath,
  type Project,
  type ShapeObject,
  type Vec2,
} from '../../core/scene';
import { upgradeProjectPolylineFairing } from './polyline-fairing-upgrade';

describe('upgradeProjectPolylineFairing', () => {
  it('upgrades an existing line-only pen drawing without dropping object metadata', () => {
    const points = arcPoints();
    const legacy = legacyPolyline(points, false);
    const project = projectWith(legacy);

    const result = upgradeProjectPolylineFairing(project);
    const upgraded = result.project.scene.objects[0];

    expect(result.upgradedCount).toBe(1);
    expect(upgraded?.kind).toBe('shape');
    expect(upgraded?.locked).toBe(true);
    expect(upgraded?.powerScale).toBe(72);
    expect(upgraded?.operationOverride).toEqual({ mode: 'line', power: 18 });
    if (upgraded?.kind !== 'shape') throw new Error('Expected an upgraded shape.');
    expect(
      upgraded.paths[0]?.curves?.[0]?.segments.every((segment) => segment.kind === 'cubic'),
    ).toBe(true);
  });

  it('leaves already-faired drawings and deliberate low-vertex shapes unchanged', () => {
    const faired = createPolyline({
      id: 'faired',
      color: '#000000',
      spec: { points: arcPoints(), closed: false },
    });
    const triangle = legacyPolyline(
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 10, y: 15 },
      ],
      true,
    );
    const project = projectWith(faired, triangle);

    const result = upgradeProjectPolylineFairing(project);

    expect(result.upgradedCount).toBe(0);
    expect(result.project).toBe(project);
  });
});

function legacyPolyline(points: ReadonlyArray<Vec2>, closed: boolean): ShapeObject {
  const spec = { points, closed };
  const polylines = polylineToPolylines(spec);
  const current = createPolyline({ id: `legacy-${closed}`, color: '#000000', spec });
  return {
    ...current,
    locked: true,
    powerScale: 72,
    operationOverride: { mode: 'line', power: 18 },
    paths: [{ color: '#000000', polylines, curves: polylines.map(polylineToCurveSubpath) }],
  };
}

function arcPoints(): Vec2[] {
  return Array.from({ length: 13 }, (_, index) => {
    const angle = (index / 12) * Math.PI;
    return { x: 50 + 50 * Math.cos(angle), y: 50 * Math.sin(angle) };
  });
}

function projectWith(...objects: ReadonlyArray<ShapeObject>): Project {
  const project = createProject();
  return {
    ...project,
    scene: {
      objects,
      layers: [createLayer({ id: '#000000', color: '#000000' })],
    },
  };
}
