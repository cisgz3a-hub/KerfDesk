// The carved stock in the Inspector's 3D view (ADR-487): a block of material
// that a CNC program carves as playback runs. A worker carves it (see
// stock-worker.ts); this hook starts one while the stock is shown, asks it to
// carve to the playhead and copies the rows it sends back into the view. For
// the project's own program it also knows the stock's thickness and material
// and the relief designs, and can colour the carving against them. The stock
// as carved can be saved as an STL solid (stock-stl.ts).

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Viewer3dSceneHandle } from '../viewer3d';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import type { Viewer3dStock } from '../viewer3d/scene-stock';
import type { StockMaterial } from '../viewer3d/scene-stock-materials';
import type { GcodeInspectionDesign } from './inspection-design';
import type { InspectorRenderModel } from './inspector-model';
import { carvesStock, type StockMoves, type StockTarget } from './stock-carving';
import type { StockComparison } from './stock-compare';
import type { StockStl } from './stock-stl';
import { startStockWorker, type StockWorkerClient } from './stock-worker-client';
import type { StockDesign, StockViewResponse } from './stock-worker-protocol';
import { stockMaterialFor, useStockMaterial } from './stock-material-preference';
import type { ToolSections } from './tool-sections';
import type { Viewer3dSceneState } from './use-viewer3d-model-installation';

/** The carving coloured against the relief design. */
export type StockCompare = {
  /** A relief design lies on the stock. */
  readonly available: boolean;
  readonly shown: boolean;
  readonly onShownChange: (shown: boolean) => void;
  readonly toleranceMm: number;
  readonly onToleranceChange: (toleranceMm: number) => void;
  /** How the carving stands against the design so far; null before the first. */
  readonly result: StockComparison | null;
};

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
  readonly compare: StockCompare;
  /** The stock as carved so far as an STL solid; null while there is none. */
  readonly stl: (() => Promise<StockStl | null>) | null;
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
  /** The project's stock and designs, for its own program. */
  readonly design: GcodeInspectionDesign | undefined;
  /** Where playback has got; the whole program when it is not playing. */
  readonly target: StockTarget;
};

export const DEFAULT_COMPARE_TOLERANCE_MM = 0.1;

export function useCarvedStock(options: CarvedStockOptions): CarvedStock {
  const { handleRef, state, model, sections, machineKind, design, target } = options;
  const [shown, setShown] = useState(false);
  const [toolpathShown, setToolpathShown] = useState(false);
  const [material, setMaterial] = useStockMaterial(stockMaterialFor(design?.stockMaterialKey));
  const compare = useCompareState();
  const available = useMemo(
    () => machineKind !== 'laser' && carvesStock(model),
    [model, machineKind],
  );
  const start = useStart(model, sections, design);
  const carving = shown && available && state === 'ready';
  const carver = useCarver(handleRef, carving ? start : null, target, compare.wanted);
  const comparing = carving && compare.shown && carver.comparable;
  useEffect(() => {
    carver.clientRef.current?.carve(target);
  }, [carver.clientRef, target.index, target.fraction]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    carver.clientRef.current?.compare(compare.wanted);
  }, [carver.clientRef, compare.wanted]);
  useEffect(() => {
    if (state !== 'ready') return;
    const handle = handleRef.current;
    handle?.setToolpathVisible(!carving || toolpathShown);
    handle?.setStockMaterial({ material, materialKey: design?.stockMaterialKey });
    handle?.setStockCompare(comparing ? compare.toleranceMm : null);
  }, [handleRef, state, carving, toolpathShown, material, design, comparing, compare.toleranceMm]);
  return {
    available,
    shown,
    onShownChange: setShown,
    toolpathShown,
    onToolpathShownChange: setToolpathShown,
    material,
    onMaterialChange: setMaterial,
    compare: {
      available: carving && carver.comparable,
      shown: compare.shown,
      onShownChange: compare.setShown,
      toleranceMm: compare.toleranceMm,
      onToleranceChange: compare.setToleranceMm,
      result: comparing ? carver.comparison : null,
    },
    stl: carver.stl,
    unknownTool: available && start.moves.tools.some((tool) => tool === null),
    failed: carving && carver.failed,
  };
}

function useCompareState() {
  const [shown, setShown] = useState(false);
  const [toleranceMm, setToleranceMm] = useState(DEFAULT_COMPARE_TOLERANCE_MM);
  return { shown, setShown, toleranceMm, setToleranceMm, wanted: shown ? toleranceMm : null };
}

// What the worker starts from: the moves, and what the project says.
function useStart(
  model: InspectorRenderModel,
  sections: ToolSections,
  design: GcodeInspectionDesign | undefined,
): { readonly moves: StockMoves; readonly design?: StockDesign } {
  return useMemo(() => {
    const moves: StockMoves = {
      segmentCount: model.segmentCount,
      positions: model.positions,
      segTool: sections.segTool,
      tools: sections.tools.map((tool) => tool.geometry),
    };
    if (design === undefined) return { moves };
    return {
      moves,
      design: {
        ...(design.stockThicknessMm === undefined ? {} : { thicknessMm: design.stockThicknessMm }),
        reliefs: design.reliefs,
      },
    };
  }, [model, sections, design]);
}

type Carver = {
  readonly clientRef: RefObject<StockWorkerClient | null>;
  readonly failed: boolean;
  /** The worker has a design to compare with. */
  readonly comparable: boolean;
  readonly comparison: StockComparison | null;
  /** Null while nothing is carving. */
  readonly stl: (() => Promise<StockStl | null>) | null;
};

// Runs one worker while there is something to carve, and puts the stock it
// carves into the view.
function useCarver(
  handleRef: RefObject<Viewer3dSceneHandle | null>,
  start: { readonly moves: StockMoves; readonly design?: StockDesign } | null,
  target: StockTarget,
  toleranceMm: number | null,
): Carver {
  const clientRef = useRef<StockWorkerClient | null>(null);
  const [failed, setFailed] = useState(false);
  const [comparable, setComparable] = useState(false);
  const [comparison, setComparison] = useState<StockComparison | null>(null);
  const latest = useRef({ target, toleranceMm });
  latest.current = { target, toleranceMm };
  useEffect(() => {
    const handle = handleRef.current;
    if (start === null || handle === null) return;
    let stock: Viewer3dStock | null = null;
    let drawn = false;
    const onResponse = (response: StockViewResponse): void => {
      if (response.kind === 'none') return setFailed(true);
      if (response.kind === 'ready') {
        stock = stockFor(response);
        setComparable(response.design !== null);
        clientRef.current?.carve(latest.current.target);
        return;
      }
      if (response.comparison !== null) setComparison(response.comparison);
      if (stock === null) return;
      stock.depth.set(response.depth, response.firstRow * stock.columns);
      // The first carve draws the stock, so it does not show whole first.
      if (drawn) return handle.updateStock();
      drawn = true;
      handle.setStock(stock);
    };
    const client = startStockWorker(start, onResponse);
    clientRef.current = client;
    client?.compare(latest.current.toleranceMm);
    setFailed(client === null);
    return () => {
      client?.dispose();
      clientRef.current = null;
      setComparable(false);
      setComparison(null);
      handle.setStock(null);
    };
  }, [handleRef, start]);
  const stl = useCallback(
    (): Promise<StockStl | null> => clientRef.current?.stl() ?? Promise.resolve(null),
    [],
  );
  return { clientRef, failed, comparable, comparison, stl: start === null || failed ? null : stl };
}

function stockFor(ready: Extract<StockViewResponse, { kind: 'ready' }>): Viewer3dStock {
  return {
    originX: ready.layout.originX,
    originY: ready.layout.originY,
    mmPerCell: ready.layout.mmPerCell,
    columns: ready.columns,
    rows: ready.rows,
    depth: new Float32Array(ready.columns * ready.rows),
    bottomZ: ready.layout.bottomZ,
    ...(ready.design === null ? {} : { target: ready.design }),
  };
}
