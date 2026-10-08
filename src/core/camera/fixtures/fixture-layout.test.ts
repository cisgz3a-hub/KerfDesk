import { describe, expect, it } from 'vitest';
import {
  fixtureContextWarnings,
  fixtureObservationMetrics,
  fixturePlacements,
} from './fixture-layout';
import { fixtureTemplate } from './fixture-test-support';
import type { ArrayPlacement } from '../../scene';

function land(x: number, y: number, p: ArrayPlacement) {
  const moved = { x: x + p.dx, y: y + p.dy };
  if (p.pivot === undefined) return moved;
  const rad = (p.rotationDeg / 180) * Math.PI,
    a = moved.x - p.pivot.x,
    b = moved.y - p.pivot.y;
  return {
    x: p.pivot.x + a * Math.cos(rad) - b * Math.sin(rad),
    y: p.pivot.y + a * Math.sin(rad) + b * Math.cos(rad),
  };
}
describe('reusable fixture intent', () => {
  it('reuses the captured sample offset and angle from a differently placed and turned current design, without scaling', () => {
    const fixture = fixtureTemplate();
    const current = { centre: { x: 25, y: 30 }, width: 20, height: 10, turnDeg: 67 };
    const plan = fixturePlacements(fixture, current, ['B', 'A']);
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;
    expect(plan.value.slotIds).toEqual(['A', 'B']);
    const first = land(25, 30, plan.value.placements[0]!);
    const second = land(25, 30, plan.value.placements[1]!);
    expect(first.x).toBeCloseTo(110, 10);
    expect(first.y).toBeCloseTo(95, 10);
    expect(second.x).toBeCloseTo(250 + 10 * Math.cos(Math.PI / 6) + 5 * Math.sin(Math.PI / 6), 10);
    expect(second.y).toBeCloseTo(100 + 10 * Math.sin(Math.PI / 6) - 5 * Math.cos(Math.PI / 6), 10);
    expect(current.turnDeg + plan.value.placements[1]!.rotationDeg).toBeCloseTo(30);
    expect(plan.value.designs.every((design) => design.width === 20 && design.height === 10)).toBe(
      true,
    );
  });
  it('centres selections for a template with no sample and supports a deliberate subset', () => {
    const { sample: _sample, ...fixture } = fixtureTemplate();
    const plan = fixturePlacements(
      fixture,
      { centre: { x: 0, y: 0 }, width: 10, height: 40, turnDeg: 0 },
      ['B'],
    );
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;
    expect(plan.value.designs[0]!.centre).toEqual({ x: 250, y: 100 });
    expect(plan.value.designs[0]!.turnDeg).toBeCloseTo(-60);
    expect(plan.value.slotIds).toEqual(['B']);
  });
  it('reports basis, calibration, surface and size differences as review warnings', () => {
    const fixture = fixtureTemplate(),
      camera = fixture.camera!;
    const warnings = fixtureContextWarnings(
      fixture,
      { ...fixture.basis, deviceProfileId: 'different', bedWidthMm: 500 },
      {
        ...camera,
        surfaceHeightMm: 8,
        model: { ...camera.model, calibratedAt: '2026-10-08T01:00:00Z' },
      },
      { centre: { x: 0, y: 0 }, width: 30, height: 15, turnDeg: 0 },
    );
    expect(warnings).toHaveLength(4);
    expect(warnings.join(' ')).toContain('without scaling');
    expect(
      fixturePlacements(fixture, { centre: { x: 0, y: 0 }, width: 30, height: 15, turnDeg: 0 }, [
        'A',
      ]).kind,
    ).toBe('ok');
    expect(fixtureContextWarnings(fixture, fixture.basis, camera, fixture.sample!.design)).toEqual(
      [],
    );
  });
  it('distinguishes manual checkpoint errors from calibration-fit residuals', () => {
    const fixture = fixtureTemplate();
    const metrics = fixtureObservationMetrics(fixture.qualification!);
    expect(metrics.samples).toBe(2);
    expect(metrics.rmsErrorMm).toBeCloseTo(Math.sqrt((0.5 ** 2 + 1) / 2), 10);
    expect(metrics.maxErrorMm).toBe(1);
    expect(metrics.meanDxMm).toBeCloseTo(0.15, 10);
    expect(metrics.meanDyMm).toBeCloseTo(0.7, 10);
    expect(fixture.camera!.model.accuracy.rmsErrorMm).toBe(0.08);
  });
  it('rejects missing/unknown slot intent and invalid current frames without a placement', () => {
    const fixture = fixtureTemplate(),
      design = fixture.sample!.design;
    expect(fixturePlacements(fixture, design, []).kind).toBe('error');
    expect(fixturePlacements(fixture, design, ['unknown']).kind).toBe('error');
    expect(fixturePlacements(fixture, { ...design, width: Number.NaN }, ['A']).kind).toBe('error');
  });
});
