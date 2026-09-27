// The carved stock in the Inspector's 3D view (ADR-487): a block of material
// that a CNC program carves as playback runs. A worker carves it (see
// stock-worker.ts); this hook starts one while the stock is shown, asks it to
// carve to the playhead and copies the rows it sends back into the view.

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Viewer3dSceneHandle } from '../viewer3d';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import type { Viewer3dStock } from '../viewer3d/scene-stock';
import type { StockMaterial } from '../viewer3d/scene-stock-materials';
import type { InspectorRenderModel } from './inspector-model';
import { carvesStock, type StockMoves, type StockTarget } from './stock-carving';
import { startStockWorker, type StockWorkerClient } from './stock-worker-client';
import type { StockWorkerResponse } from './stock-worker-protocol';
import { useStockMaterial } from './stock-material-preference';
import type { ToolSections } from './tool-sections';
import type { Viewer3dSceneState } from './use-viewer3d-model-installation';

export type CarvedStock = {
  /** The program cuts below the stock top, so there is stock to show. */
  readonly available: boolean;
  readonly shown: boolean;
  readonly onShownChange: (shown: boolean) => void;
  /** The toolpath is drawn over the stock too. */
  readonly toolpathShown: boolean;
  readonly onToolpathShownChange: (shown: boolean) => void;
  readonly material: StockMaterial;
  readonly onMaterialChange: (material: StockMaterial) => void;
  /** Some moves cut with a bit the program gives no size for. */
  readonly unknownTool: boolean;
  /** Could not carve here: no worker, or no room for the grid. */
  readonly failed: boolean;
};

type CarvedStockOptions = {
  readonly handleRef: RefObject<Viewer3dSceneHandle | null>;
  readonly state: Viewer3dSceneState;
  readonly model: InspectorRenderModel;
  readonly sections: ToolSections;
  readonly machineKind: 'laser' | 'cnc' | undefined;
  /** Where playback has got; the whole program when it is not playing. */
  readonly target: StockTarget;
};

export function useCarvedStock(options: CarvedStockOptions): CarvedStock {
  const { handleRef, state, model, sections, machineKind, target } = options;
  const [shown, setShown] = useState(false);
  const [toolpathShown, setToolpathShown] = useState(false);
  const [failed, setFailed] = useState(false);
  const [material, setMaterial] = useStockMaterial();
  const available = useMemo(
    () => machineKind !== 'laser' && carvesStock(model),
    [model, machineKind],
  );
  const moves = useMemo<StockMoves>(
    () => ({
      segmentCount: model.segmentCount,
      positions: model.positions,
      segTool: sections.segTool,
      tools: sections.tools.map((tool) => tool.geometry),
    }),
    [model, sections],
  );
  const carving = shown && available && state === 'ready';
  const clientRef = useCarver(handleRef, carving ? moves : null, target, setFailed);
  useEffect(() => {
    clientRef.current?.carve(target);
  }, [clientRef, target.index, target.fraction]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (state !== 'ready') return;
    handleRef.current?.setToolpathVisible(!carving || toolpathShown);
    handleRef.current?.setStockMaterial(material);
  }, [handleRef, state, carving, toolpathShown, material]);
  return {
    available,
    shown,
    onShownChange: setShown,
    toolpathShown,
    onToolpathShownChange: setToolpathShown,
    material,
    onMaterialChange: setMaterial,
    unknownTool: available && moves.tools.some((tool) => tool === null),
    failed: carving && failed,
  };
}

// Runs one worker for the moves while they are given, and puts the stock it
// carves into the view.
function useCarver(
  handleRef: RefObject<Viewer3dSceneHandle | null>,
  moves: StockMoves | null,
  target: StockTarget,
  setFailed: (failed: boolean) => void,
): RefObject<StockWorkerClient | null> {
  const clientRef = useRef<StockWorkerClient | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    const handle = handleRef.current;
    if (moves === null || handle === null) return;
    let stock: Viewer3dStock | null = null;
    let drawn = false;
    const onResponse = (response: StockWorkerResponse): void => {
      if (response.kind === 'none') return setFailed(true);
      if (response.kind === 'ready') {
        stock = stockFor(response);
        clientRef.current?.carve(targetRef.current);
        return;
      }
      if (stock === null) return;
      stock.depth.set(response.depth, response.firstRow * stock.columns);
      // The first carve draws the stock, so it does not show whole first.
      if (drawn) return handle.updateStock();
      drawn = true;
      handle.setStock(stock);
    };
    const client = startStockWorker(moves, onResponse);
    clientRef.current = client;
    setFailed(client === null);
    return () => {
      client?.dispose();
      clientRef.current = null;
      handle.setStock(null);
    };
  }, [handleRef, moves, setFailed]);
  return clientRef;
}

function stockFor(ready: Extract<StockWorkerResponse, { kind: 'ready' }>): Viewer3dStock {
  return {
    originX: ready.layout.originX,
    originY: ready.layout.originY,
    mmPerCell: ready.layout.mmPerCell,
    columns: ready.columns,
    rows: ready.rows,
    depth: new Float32Array(ready.columns * ready.rows),
    bottomZ: ready.layout.bottomZ,
  };
}
