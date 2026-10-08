import { toMachineCoords, toSceneCoords } from '../devices';
import type { Project } from '../scene/project';
import type { Scene } from '../scene/scene';
import type { CncStock } from '../scene/machine';
import type { CncTwoSidedSetup } from '../scene/cnc-two-sided-setup';
import type { SceneObject, Vec2 } from '../scene/scene-object';

/** Independently defined physical flip in work coordinates; Z remains side-local stock-top. */
export function cncSideBPoint(point: Vec2, stock: CncStock, side: CncTwoSidedSetup): Vec2 {
  const x = point.x - stock.originOffset.x,
    y = point.y - stock.originOffset.y;
  return {
    x: side.sideBStockOriginMm.x + (side.flipAxis === 'y' ? stock.widthMm - x : x),
    y: side.sideBStockOriginMm.y + (side.flipAxis === 'x' ? stock.heightMm - y : y),
  };
}
export function cncSideInputScene(project: Project, scene: Scene): Scene {
  const side = project.machine?.kind === 'cnc' ? project.cncSetup?.twoSided : undefined;
  if (side === undefined) return scene;
  const ids = new Set(side.activeSide === 'A' ? side.sideAObjectIds : side.sideBObjectIds);
  return { ...scene, objects: scene.objects.filter((object) => ids.has(object.id)) };
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
