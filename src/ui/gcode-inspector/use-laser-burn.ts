// The laser burn preview in the Inspector's 3D view (ADR-487): the sheet a
// laser program burns, darkened as playback runs. A worker burns it (see
// burn-worker.ts); this hook starts one while the burn is shown, asks it to
// burn to the playhead and copies the rows it sends back into the view. With
// a rotary set up the burn can be wrapped round the work it turns.

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Viewer3dSceneHandle } from '../viewer3d';
// Deep imports: the viewer3d barrel is capped at 20 exports by its index contract.
import type { Viewer3dBurn } from '../viewer3d/scene-burn';
import type { StockMaterial } from '../viewer3d/scene-stock-materials';
import { burnsAnything, type BurnLaser, type BurnMoves } from './burn-grid';
import { startBurnWorker, type BurnWorkerClient } from './burn-worker-client';
import type { BurnWorkerResponse } from './burn-worker-protocol';
import type { GcodeInspectionLaser } from './gcode-inspection-source';
import type { InspectorRenderModel } from './inspector-model';
import { carvesStock, type StockTarget } from './stock-carving';
import { BURN_MATERIAL_KEY, useStockMaterial } from './stock-material-preference';
import type { Viewer3dSceneState } from './use-viewer3d-model-installation';

export type LaserBurn = {
  /** The program burns, and is not a CNC program. */
  readonly available: boolean;
  readonly shown: boolean;
  readonly onShownChange: (shown: boolean) => void;
  /** The toolpath is drawn over the burn too. */
  readonly toolpathShown: boolean;
  readonly onToolpathShownChange: (shown: boolean) => void;
  /** The burn covers the toolpath, so the view leaves it out. */
  readonly hidesToolpath: boolean;
  readonly material: StockMaterial;
  readonly onMaterialChange: (material: StockMaterial) => void;
  /** Wrapped round the rotary; null without a rotary to wrap round. */
  readonly wrap: {
    readonly shown: boolean;
    readonly onShownChange: (shown: boolean) => void;
    readonly diameterMm: number;
  } | null;
  /** The S value the preview takes as full power. */
  readonly fullPowerS: number;
  /** Could not burn here: no worker. */
  readonly failed: boolean;
};

type LaserBurnOptions = {
  readonly handleRef: RefObject<Viewer3dSceneHandle | null>;
  readonly state: Viewer3dSceneState;
  readonly model: InspectorRenderModel;
  readonly machineKind: 'laser' | 'cnc' | undefined;
  /** The laser the program burns with; GRBL's defaults without one. */
  readonly laser: GcodeInspectionLaser | undefined;
  /** Where playback has got; the whole program when it is not playing. */
  readonly target: StockTarget;
};

const DEFAULT_LASER: GcodeInspectionLaser = { maxPowerS: 1000, spotMm: 0.1 };

export function useLaserBurn(options: LaserBurnOptions): LaserBurn {
  const { handleRef, state, model, machineKind, target } = options;
  const laser = options.laser ?? DEFAULT_LASER;
  const [shown, setShown] = useState(false);
  const [toolpathShown, setToolpathShown] = useState(false);
  const [wrapped, setWrapped] = useState(true);
  const [material, setMaterial] = useStockMaterial(null, BURN_MATERIAL_KEY);
  const available = useMemo(() => burnable(model, machineKind), [model, machineKind]);
  const wrapping = wrapped && laser.rotary !== undefined;
  const start = useStart(model, laser, wrapping);
  const burning = shown && available && state === 'ready';
  const burner = useBurner(handleRef, burning ? start : null, target);
  useEffect(() => {
    burner.clientRef.current?.burn(target);
  }, [burner.clientRef, target.index, target.fraction]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (state === 'ready') handleRef.current?.setBurnMaterial({ material });
  }, [handleRef, state, material]);
  return {
    available,
    shown,
    onShownChange: setShown,
    toolpathShown,
    onToolpathShownChange: setToolpathShown,
    hidesToolpath: burning && !toolpathShown,
    material,
    onMaterialChange: setMaterial,
    wrap:
      laser.rotary === undefined
        ? null
        : { shown: wrapped, onShownChange: setWrapped, diameterMm: laser.rotary.diameterMm },
    fullPowerS: laser.maxPowerS,
    failed: burning && burner.failed,
  };
}

// A laser program burns; so does an opened file that burns and cuts nothing
// below Z0, which the carved stock would show instead.
function burnable(model: InspectorRenderModel, machineKind: 'laser' | 'cnc' | undefined): boolean {
  if (machineKind === 'cnc') return false;
  if (machineKind === undefined && carvesStock(model)) return false;
  return burnsAnything(model);
}

type BurnStart = {
  readonly moves: BurnMoves;
  readonly laser: BurnLaser;
  /** The work's diameter, when the burn wraps round a rotary. */
  readonly wrapDiameterMm?: number;
};

function useStart(
  model: InspectorRenderModel,
  laser: GcodeInspectionLaser,
  wrapping: boolean,
): BurnStart {
  const { maxPowerS, spotMm, rotary } = laser;
  return useMemo(() => {
    const moves: BurnMoves = {
      segmentCount: model.segmentCount,
      positions: model.positions,
      segKind: model.segKind,
      segPower: model.segPower,
    };
    if (!wrapping || rotary === undefined) return { moves, laser: { maxPowerS, spotMm } };
    return {
      moves,
      laser: { maxPowerS, spotMm, wrapYMm: rotary.wrapYMm },
      wrapDiameterMm: rotary.diameterMm,
    };
  }, [model, maxPowerS, spotMm, rotary, wrapping]);
}

// Runs one worker while the burn is shown, and puts the burn into the view.
function useBurner(
  handleRef: RefObject<Viewer3dSceneHandle | null>,
  start: BurnStart | null,
  target: StockTarget,
): { readonly clientRef: RefObject<BurnWorkerClient | null>; readonly failed: boolean } {
  const clientRef = useRef<BurnWorkerClient | null>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef(target);
  latest.current = target;
  useEffect(() => {
    const handle = handleRef.current;
    if (start === null || handle === null) return;
    let burn: Viewer3dBurn | null = null;
    let drawn = false;
    const onResponse = (response: BurnWorkerResponse): void => {
      if (response.kind === 'none') return setFailed(true);
      if (response.kind === 'ready') {
        const { layout } = response;
        burn = {
          ...layout,
          darkness: new Uint8Array(layout.columns * layout.rows),
          ...(start.wrapDiameterMm === undefined ? {} : { wrapDiameterMm: start.wrapDiameterMm }),
        };
        clientRef.current?.burn(latest.current);
        return;
      }
      if (burn === null) return;
      burn.darkness.set(response.darkness, response.firstRow * burn.columns);
      // The first burn draws the sheet, so it does not show bare first.
      if (drawn) return handle.updateBurn();
      drawn = true;
      handle.setBurn(burn);
    };
    const client = startBurnWorker(start, onResponse);
    clientRef.current = client;
    setFailed(client === null);
    return () => {
      client?.dispose();
      clientRef.current = null;
      handle.setBurn(null);
    };
  }, [handleRef, start]);
  return { clientRef, failed };
}
