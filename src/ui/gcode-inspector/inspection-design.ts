// What the project says about the stock and the design a CNC program was
// compiled from, for the Inspector's carved stock (ADR-487): how thick the
// stock is, what it is made of, and the relief designs the program carves,
// placed where the program carves them. An opened file has none of this.

import { reliefMachineSpaceTransform } from '../../core/cnc/relief-machine-space';
import { toMachineCoords, type DeviceProfile } from '../../core/devices';
import { applyTransform, type Project, type ReliefObject, type Vec2 } from '../../core/scene';
import type { EmittedDesignPlacement } from '../laser/save-output-emission';

/**
 * A relief's heightmap millimetres to program X and Y:
 * x' = a·x + c·y + e and y' = b·x + d·y + f, as [a, b, c, d, e, f].
 */
export type ProgramAffine = readonly [number, number, number, number, number, number];

export type InspectionRelief = {
  readonly relief: ReliefObject;
  readonly toProgram: ProgramAffine;
};

export type GcodeInspectionDesign = {
  /** How thick the project's stock is: Z0 is its top. */
  readonly stockThicknessMm?: number;
  /** The project's stock material, a CNC material key. */
  readonly stockMaterialKey?: string;
  /** The reliefs the program carves. */
  readonly reliefs: ReadonlyArray<InspectionRelief>;
};

/** The design of a CNC project's program; none for a laser project. */
export function projectInspectionDesign(
  project: Project,
  placement: EmittedDesignPlacement | undefined,
): GcodeInspectionDesign | undefined {
  const machine = project.machine;
  if (machine?.kind !== 'cnc') return undefined;
  const { stock } = machine;
  const ids = new Set(placement?.reliefIds ?? []);
  const reliefs =
    placement === undefined
      ? []
      : project.scene.objects
          .filter(
            (object): object is ReliefObject => object.kind === 'relief' && ids.has(object.id),
          )
          .map((relief) => ({
            relief,
            toProgram: reliefToProgram(relief, project.device, placement.jobOriginOffset),
          }));
  return {
    ...(Number.isFinite(stock.thicknessMm) && stock.thicknessMm > 0
      ? { stockThicknessMm: stock.thicknessMm }
      : {}),
    ...(stock.materialKey === undefined ? {} : { stockMaterialKey: stock.materialKey }),
    reliefs,
  };
}

/**
 * Where the compiler puts a relief's heightmap in the program: the relief's
 * own placement less the scale planning took out, the machine's origin, then
 * the job's placement (compile-cnc-relief.ts, prepare-output.ts). Each step
 * is affine, so three points fix the whole.
 */
export function reliefToProgram(
  relief: ReliefObject,
  device: DeviceProfile,
  jobOriginOffset: Vec2,
): ProgramAffine {
  const residual = reliefMachineSpaceTransform(relief.transform).residualTransform;
  const place = (x: number, y: number): Vec2 => {
    const machine = toMachineCoords(applyTransform({ x, y }, residual), device);
    return { x: machine.x + jobOriginOffset.x, y: machine.y + jobOriginOffset.y };
  };
  const origin = place(0, 0);
  const alongX = place(1, 0);
  const alongY = place(0, 1);
  return [
    alongX.x - origin.x,
    alongX.y - origin.y,
    alongY.x - origin.x,
    alongY.y - origin.y,
    origin.x,
    origin.y,
  ];
}
