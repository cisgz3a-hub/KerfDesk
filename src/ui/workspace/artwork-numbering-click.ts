import {
  artworkRunUnitForObject,
  artworkRunUnits,
  moveArtworkRunUnitsToPosition,
} from '../../core/artwork-run-units';
import { hitTest, type Project, type Vec2 } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { canvasTheme } from '../theme/canvas-theme';
import { canvasMouseToScene, type ViewState } from './view-transform';

export type ArtworkNumberingHit =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'assigned' | 'new';
      readonly unitKey: string;
      readonly objectIds: ReadonlyArray<string>;
      readonly order: ReadonlyArray<string>;
      readonly position: number;
      readonly color: string;
    };

export function artworkNumberingHit(args: {
  readonly project: Project;
  readonly point: Vec2;
  readonly nextPosition: number;
  readonly assignedUnitKeys: ReadonlyArray<string>;
}): ArtworkNumberingHit {
  const objectId = hitTest(args.project.scene, args.point);
  if (objectId === null) return { kind: 'empty' };
  const unit = artworkRunUnitForObject(args.project.scene, objectId);
  if (unit === null) return { kind: 'empty' };
  const units = artworkRunUnits(args.project.scene);
  const assigned = args.assignedUnitKeys.includes(unit.key);
  const position = assigned
    ? Math.max(1, units.findIndex((candidate) => candidate.key === unit.key) + 1)
    : args.nextPosition;
  const layer = args.project.scene.layers.find(
    (candidate) => candidate.id === unit.operationIds[0],
  );
  return {
    kind: assigned ? 'assigned' : 'new',
    unitKey: unit.key,
    objectIds: unit.objectIds,
    order: assigned
      ? units.flatMap((candidate) => candidate.objectIds)
      : moveArtworkRunUnitsToPosition(args.project.scene, new Set(unit.objectIds), position),
    position,
    color: layer?.color ?? canvasTheme.selection,
  };
}

export function handleArtworkNumberingPointerDown(args: {
  readonly event: React.MouseEvent<HTMLCanvasElement>;
  readonly canvas: HTMLCanvasElement | null;
  readonly project: Project;
  readonly viewState: ViewState;
}): boolean {
  if (useStore.getState().previewMode) return false;
  const ui = useUiStore.getState();
  if (ui.artworkNumbering.kind !== 'active' || args.event.button !== 0) return false;
  const point = canvasMouseToScene(args.event, args.canvas, args.project, args.viewState);
  if (point === null) return true;
  const hit = artworkNumberingHit({
    project: args.project,
    point,
    nextPosition: ui.artworkNumbering.nextPosition,
    assignedUnitKeys: ui.artworkNumbering.assignedUnitKeys,
  });
  if (hit.kind === 'empty') return true;
  const app = useStore.getState();
  app.selectObjects(hit.objectIds);
  const focus = { objectIds: hit.objectIds, position: hit.position, color: hit.color };
  if (hit.kind === 'assigned') {
    ui.setArtworkRunFocus(focus);
    return true;
  }
  app.setArtworkOrderDuringInteraction(hit.order);
  ui.recordArtworkNumbering(hit.unitKey, hit.order, focus);
  if (
    ui.artworkNumbering.assignedUnitKeys.length + 1 >=
    artworkRunUnits(args.project.scene).length
  ) {
    app.endInteraction();
    ui.finishArtworkNumbering();
  }
  return true;
}
