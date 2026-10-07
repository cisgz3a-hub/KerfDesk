import { err, ok, type Result } from '../../result';
import type { ArrayPlacement, Vec2 } from '../../scene';
import { piecePlacements, type DesignFrame } from '../pieces/piece-placements';
import type { CameraModelRecord } from '../model/camera-model-record';
import { normalizeFixtureTemplate } from './fixture-template-normalize';
import type {
  FixtureBasis,
  FixtureCameraContext,
  FixtureQualification,
  FixtureTemplate,
} from './fixture-template';

export type FixturePlacementPlan = {
  readonly placements: ReadonlyArray<ArrayPlacement>;
  readonly designs: ReadonlyArray<DesignFrame>;
  readonly slotIds: ReadonlyArray<string>;
};
export function fixturePlacements(
  template: FixtureTemplate,
  current: DesignFrame,
  includedIds: ReadonlyArray<string>,
): Result<FixturePlacementPlan, { readonly message: string }> {
  const normalized = normalizeFixtureTemplate(template);
  if (normalized === undefined || !validDesign(current))
    return err({ message: 'This fixture or selection frame is invalid.' });
  const included = new Set(includedIds);
  const targets = normalized.slots.filter((slot) => included.has(slot.id));
  if (targets.length === 0 || targets.length !== included.size)
    return err({ message: 'Choose at least one current fixture slot to place on.' });
  const sample = normalized.slots.find((slot) => slot.id === normalized.sample?.slotId);
  const design = normalized.sample?.design ?? current;
  const ordered = [
    ...targets.filter((slot) => slot === sample),
    ...targets.filter((slot) => slot !== sample),
  ];
  const saved = piecePlacements({
    pieces: ordered.map((slot) => slot.piece),
    design,
    sample: sample?.piece ?? null,
  });
  const designs = saved.map((placement) => ({
    ...current,
    centre: land(design.centre, placement),
    turnDeg: design.turnDeg + placement.rotationDeg,
  }));
  const placements = designs.map((target) => ({
    dx: target.centre.x - current.centre.x,
    dy: target.centre.y - current.centre.y,
    rotationDeg: target.turnDeg - current.turnDeg,
    pivot: target.centre,
  }));
  return ok({ placements, designs, slotIds: ordered.map((slot) => slot.id) });
}
function validDesign(design: DesignFrame): boolean {
  return (
    [design.centre.x, design.centre.y, design.width, design.height, design.turnDeg].every(
      Number.isFinite,
    ) &&
    design.width > 0 &&
    design.height > 0
  );
}
function land(point: Vec2, placement: ArrayPlacement): Vec2 {
  const moved = { x: point.x + placement.dx, y: point.y + placement.dy };
  if (placement.pivot === undefined || placement.rotationDeg === 0) return moved;
  const angle = (placement.rotationDeg * Math.PI) / 180;
  const dx = moved.x - placement.pivot.x,
    dy = moved.y - placement.pivot.y;
  return {
    x: placement.pivot.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: placement.pivot.y + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}
export function fixtureContextWarnings(
  template: FixtureTemplate,
  basis: FixtureBasis,
  camera: FixtureCameraContext | undefined,
  design: DesignFrame | null,
): ReadonlyArray<string> {
  const warnings: string[] = [];
  if (
    template.basis.deviceProfileId !== basis.deviceProfileId ||
    template.basis.bedWidthMm !== basis.bedWidthMm ||
    template.basis.bedHeightMm !== basis.bedHeightMm
  )
    warnings.push(
      'The device profile or bed dimensions differ from the recorded fixture basis. Verify the fixture origin and every slot.',
    );
  if (template.camera === undefined)
    warnings.push(
      'No camera context was recorded for this fixture. Verify its physical alignment independently.',
    );
  else if (camera === undefined)
    warnings.push(
      'The current camera context is unavailable. Saved geometry is historical placement intent.',
    );
  else warnings.push(...cameraContextWarnings(template.camera, camera));
  if (
    template.sample !== undefined &&
    design !== null &&
    (Math.abs(template.sample.design.width - design.width) > 0.01 ||
      Math.abs(template.sample.design.height - design.height) > 0.01)
  )
    warnings.push(
      'The selection dimensions differ from the saved sample. The design is moved and rotated without scaling; inspect the fit in each slot.',
    );
  if (template.slots.some((slot) => slot.piece.partial))
    warnings.push(
      'This fixture includes partially observed outlines. Check their positions and orientation.',
    );
  return warnings;
}
function cameraContextWarnings(
  saved: FixtureCameraContext,
  current: FixtureCameraContext,
): string[] {
  const warnings: string[] = [];
  if (cameraGeometryKey(saved.model) !== cameraGeometryKey(current.model))
    warnings.push(
      'The camera calibration, capture binding or head pose differs from the saved context. Verify current placement.',
    );
  if (
    saved.surfaceHeightMm !== current.surfaceHeightMm ||
    JSON.stringify(saved.heightAreas) !== JSON.stringify(current.heightAreas)
  )
    warnings.push(
      'The current surface height or height areas differ from the recorded fixture. Recheck at the actual stock height.',
    );
  return warnings;
}
function cameraGeometryKey(model: CameraModelRecord): string {
  return JSON.stringify({
    calibratedAt: model.calibratedAt,
    lens: model.lens,
    pose: model.pose,
    capture: model.capture,
    mount: model.mount,
  });
}
export function fixtureObservationMetrics(record: FixtureQualification): {
  readonly samples: number;
  readonly rmsErrorMm: number;
  readonly maxErrorMm: number;
  readonly meanDxMm: number;
  readonly meanDyMm: number;
} {
  let sumSquares = 0,
    maxErrorMm = 0,
    dxSum = 0,
    dySum = 0;
  for (const point of record.points) {
    const dx = point.observedMm.x - point.expectedMm.x,
      dy = point.observedMm.y - point.expectedMm.y;
    sumSquares += dx * dx + dy * dy;
    maxErrorMm = Math.max(maxErrorMm, Math.hypot(dx, dy));
    dxSum += dx;
    dySum += dy;
  }
  const samples = record.points.length;
  return {
    samples,
    rmsErrorMm: samples === 0 ? 0 : Math.sqrt(sumSquares / samples),
    maxErrorMm,
    meanDxMm: samples === 0 ? 0 : dxSum / samples,
    meanDyMm: samples === 0 ? 0 : dySum / samples,
  };
}
