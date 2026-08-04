import { tileJobs, type TiledJobsResult } from '../../core/cnc/tile-jobs';
import type { ActiveWorkCoordinateSystem } from '../../core/controllers/grbl/work-offset-readback';
import type { ControllerSettingsSnapshot } from '../../core/preflight';
import type { PreparedOutput } from '../../io/gcode';
import { detectMachineJobWarnings } from '../laser/machine-job-warnings';
import { emitTileFiles, type TileFile } from './tile-emission';

export type TiledOutputPreparation =
  | { readonly kind: 'preparation-failed'; readonly messages: ReadonlyArray<string> }
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'work-budget-exceeded';
      readonly grid: Extract<TiledJobsResult, { readonly kind: 'work-budget-exceeded' }>['grid'];
    }
  | {
      readonly kind: 'tile-preflight-failed';
      readonly row: number;
      readonly col: number;
      readonly messages: ReadonlyArray<string>;
    }
  | {
      readonly kind: 'ready';
      readonly files: ReadonlyArray<TileFile>;
      readonly machineWarnings: ReadonlyArray<string>;
      readonly tileAdvisories: ReadonlyArray<string>;
      readonly preparationAdvisories: ReadonlyArray<string>;
      readonly emissionAdvisories: ReadonlyArray<string>;
    };

/** Ordered tiling, per-tile preflight, and emission from one exact prepared Job. */
export function finalizeTiledOutput(
  prepared: PreparedOutput,
  savedName: string | null,
  controllerSettings: ControllerSettingsSnapshot | null,
  activeWcs: ActiveWorkCoordinateSystem | null,
): TiledOutputPreparation {
  if (!prepared.ok) {
    return {
      kind: 'preparation-failed',
      messages: prepared.preflight.issues.map((issue) => issue.message),
    };
  }
  const machine = prepared.project.machine;
  if (machine?.kind !== 'cnc' || machine.tiling === undefined) {
    return { kind: 'preparation-failed', messages: ['CNC tiling is not configured.'] };
  }
  const tiled = tileJobs(prepared.job, machine.tiling);
  if (tiled.kind === 'empty') return tiled;
  if (tiled.kind === 'work-budget-exceeded') return tiled;
  const emitted = emitTileFiles(prepared.project, machine, tiled.tiles, savedName, prepared.job);
  if (emitted.kind === 'failed') {
    return {
      kind: 'tile-preflight-failed',
      row: emitted.row,
      col: emitted.col,
      messages: emitted.messages,
    };
  }
  return {
    kind: 'ready',
    files: emitted.files,
    machineWarnings: detectMachineJobWarnings(
      prepared.project,
      controllerSettings,
      activeWcs,
      prepared,
    ),
    tileAdvisories: tiled.advisories ?? [],
    preparationAdvisories: (prepared.advisories ?? []).map((issue) => issue.message),
    emissionAdvisories: emitted.advisories,
  };
}
