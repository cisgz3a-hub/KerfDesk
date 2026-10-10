// What the Inspector's 3D view draws of the material (ADR-487): the stock a
// CNC program carves, or the sheet a laser program burns. Either can cover
// the toolpath, so the view leaves the toolpath out while one does.

import { useEffect, type RefObject } from 'react';
import type { Viewer3dSceneHandle } from '../viewer3d';
import type { GcodeInspectionSource } from './gcode-inspection-source';
import type { InspectorRenderModel } from './inspector-model';
import type { StockTarget } from './stock-carving';
import type { ToolSections } from './tool-sections';
import { useCarvedStock, type CarvedStock } from './use-carved-stock';
import { useLaserBurn, type LaserBurn } from './use-laser-burn';
import type { Viewer3dSceneState } from './use-viewer3d-model-installation';

export function useInspectorMaterials(options: {
  readonly handleRef: RefObject<Viewer3dSceneHandle | null>;
  readonly state: Viewer3dSceneState;
  readonly model: InspectorRenderModel;
  readonly sections: ToolSections;
  readonly source: GcodeInspectionSource | undefined;
  /** Where playback has got; the whole program when it is not playing. */
  readonly target: StockTarget;
  /** Start with the carved stock shown (ADR-578). */
  readonly stockInitiallyShown?: boolean;
}): { readonly stock: CarvedStock; readonly burn: LaserBurn } {
  const { handleRef, state, model, source, target } = options;
  const machineKind = source?.machineKind;
  const stock = useCarvedStock({
    handleRef,
    state,
    model,
    sections: options.sections,
    machineKind,
    design: source?.design,
    target,
    initiallyShown: options.stockInitiallyShown === true,
  });
  const burn = useLaserBurn({ handleRef, state, model, machineKind, laser: source?.laser, target });
  const hidden = stock.hidesToolpath || burn.hidesToolpath;
  useEffect(() => {
    if (state === 'ready') handleRef.current?.setToolpathVisible(!hidden);
  }, [handleRef, state, hidden]);
  return { stock, burn };
}
