// Pointer-up for a selection box, split out of use-workspace-drag.ts to keep
// that module under the file-size cap.

import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import type { Project, Vec2 } from '../../core/scene';
import type { DragState } from './drag-state';
import type { PressRelease } from './drag-threshold';
import { selectObjectsInMarquee } from './selection-marquee';
import { canvasMouseToScene, type ViewState } from './view-transform';

export function commitSelectionMarquee(args: {
  readonly drag: Extract<DragState, { kind: 'marquee' }>;
  readonly release: PressRelease;
  readonly selectObject: (id: string | null) => void;
  readonly e: ReactMouseEvent<HTMLCanvasElement>;
  readonly ref: RefObject<HTMLCanvasElement | null>;
  readonly project: Project;
  readonly viewState: ViewState;
  readonly selectObjects: (
    ids: ReadonlyArray<string>,
    options?: { readonly additive?: boolean },
  ) => void;
  readonly setSelectionMarquee: (
    marquee: { readonly start: Vec2; readonly end: Vec2 } | null,
  ) => void;
}): void {
  const end = canvasMouseToScene(args.e, args.ref.current, args.project, args.viewState);
  args.setSelectionMarquee(null);
  // The press landed inside an outline that was not selected: a click selects
  // it (ADR-196), and only a drag draws the box (ADR-196 Amendment 1).
  if (args.release.click && args.drag.clickSelectsId !== undefined) {
    args.selectObject(args.drag.clickSelectsId);
    return;
  }
  if (end === null) return;
  const ids = selectObjectsInMarquee(args.project.scene, args.drag.startScenePoint, end);
  args.selectObjects(ids, { additive: args.drag.additive });
}
