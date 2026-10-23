import { toMachineCoords, toSceneCoords } from '../devices';
import type { Project } from '../scene/project';
import type { Scene } from '../scene/scene';
import type { CncStock } from '../scene/machine';
import type { CncTwoSidedSetup } from '../scene/cnc-two-sided-setup';
import type { MeshReliefObject, SceneObject, Vec2 } from '../scene/scene-object';
import { reliefSideForStock } from '../relief/relief-two-sided-stock';

/** Independently defined physical flip in work coordinates; Z remains side-local stock-top. */
export function cncSideBPoint(point: Vec2, stock: CncStock, side: CncTwoSidedSetup): Vec2 {
  const x = point.x - stock.originOffset.x,
    y = point.y - stock.originOffset.y;
  return {
    x: side.sideBStockOriginMm.x + (side.flipAxis === 'y' ? stock.widthMm - x : x),
    y: side.sideBStockOriginMm.y + (side.flipAxis === 'x' ? stock.heightMm - y : y),
  };
}
/** The active side's objects, with each two-sided split side planned for the current stock. */
export function cncSideInputScene(project: Project, scene: Scene): Scene {
  const machine = project.machine;
  if (machine?.kind !== 'cnc') return scene;
  const fitted = reliefSidesForStock(scene, machine.stock.thicknessMm);
  const side = project.cncSetup?.twoSided;
  if (side === undefined) return fitted;
  const ids = new Set(side.activeSide === 'A' ? side.sideAObjectIds : side.sideBObjectIds);
  return { ...fitted, objects: fitted.objects.filter((object) => ids.has(object.id)) };
}

// ADR-580 Amendment 1: a split's side reliefs follow a stock edit made after
// the split; a side with no stock left to carve drops out of its program.
function reliefSidesForStock(scene: Scene, stockThicknessMm: number): Scene {
  let changed = false;
  const fit = (objects: ReadonlyArray<SceneObject>): SceneObject[] =>
    objects.flatMap((object) => {
      if (object.kind !== 'relief' || object.reliefSource.kind !== 'legacy-mesh') return [object];
      const side = reliefSideForStock(object as MeshReliefObject, stockThicknessMm);
      if (side.kind === 'no-stock') {
        changed = true;
        return [];
      }
      if (side.relief !== object) changed = true;
      return [side.relief];
    });
  const objects = fit(scene.objects);
  const outputDependencies =
    scene.outputDependencies === undefined ? undefined : fit(scene.outputDependencies);
  if (!changed) return scene;
  return {
    ...scene,
    objects,
    ...(outputDependencies === undefined ? {} : { outputDependencies }),
  };
}
/** Flip retained source placement before CAM, so contour direction, ramps and contact are replanned. */
export function cncSideOutputProject(project: Project, scene: Scene): Project {
  const machine = project.machine,
    side = project.cncSetup?.twoSided;
  if (machine?.kind !== 'cnc' || side?.activeSide !== 'B')
    return scene === project.scene ? project : { ...project, scene };
  const map = (object: SceneObject): SceneObject => {
    const position = toSceneCoords(
      cncSideBPoint(toMachineCoords(object.transform, project.device), machine.stock, side),
      project.device,
    );
    return {
      ...object,
      transform: {
        ...object.transform,
        x: position.x,
        y: position.y,
        rotationDeg: -object.transform.rotationDeg,
        mirrorX: side.flipAxis === 'y' ? !object.transform.mirrorX : object.transform.mirrorX,
        mirrorY: side.flipAxis === 'x' ? !object.transform.mirrorY : object.transform.mirrorY,
      },
    };
  };
  return {
    ...project,
    ...(project.startPoints?.job === undefined || project.startPoints.job.relative === true
      ? {}
      : {
          startPoints: {
            ...project.startPoints,
            job: toSceneCoords(
              cncSideBPoint(
                toMachineCoords(project.startPoints.job, project.device),
                machine.stock,
                side,
              ),
              project.device,
            ),
          },
        }),
    machine: { ...machine, stock: { ...machine.stock, originOffset: side.sideBStockOriginMm } },
    scene: {
      ...scene,
      objects: scene.objects.map(map),
      ...(scene.outputDependencies === undefined
        ? {}
        : { outputDependencies: scene.outputDependencies.map(map) }),
    },
  };
}
export function cncSideProgramName(filename: string, project: Project): string {
  const side = project.machine?.kind === 'cnc' ? project.cncSetup?.twoSided?.activeSide : undefined;
  return side === undefined ? filename : filename.replace(/(\.[^.]+)?$/, '-side-' + side + '$1');
}
export function cncSideHeader(project: Project): string {
  const side = project.machine?.kind === 'cnc' ? project.cncSetup?.twoSided : undefined;
  if (side === undefined) return '';
  return (
    '; CNC side ' +
    side.activeSide +
    ' | G54 | stock top Z0 | flip around ' +
    side.flipAxis.toUpperCase() +
    '\n'
  );
}
export function cncSideRegistrationPoints(
  stock: CncStock,
  side: CncTwoSidedSetup,
): ReadonlyArray<Vec2> {
  return side.registration.map((feature) => {
    const point = {
      x: stock.originOffset.x + feature.stockXMm,
      y: stock.originOffset.y + feature.stockYMm,
    };
    return side.activeSide === 'A' ? point : cncSideBPoint(point, stock, side);
  });
}
