// Canvas hover chrome (ADR-242): one hook composing the three imperative
// pointer followers — brush cursor circle, selection-mode badge, and the
// Info readout — so the canvas component stays inside its size caps and
// pointer moves never re-render React.

import { useCallback } from 'react';
import type { BrushSettings, EditorTool } from './editor-session';
import type { EditorView } from './image-editor-types';
import { useBrushCursor } from './use-brush-cursor';
import { useInfoReadout } from './use-info-readout';
import { useModeBadge } from './use-mode-badge';

type CanvasHover = {
  readonly canvasCursor: string;
  readonly cursorRef: React.RefObject<HTMLDivElement>;
  readonly badgeRef: React.RefObject<HTMLDivElement>;
  readonly infoRef: React.RefObject<HTMLDivElement>;
  readonly onHoverMove: (e: React.PointerEvent<HTMLElement>) => void;
  readonly onHoverLeave: () => void;
};

export function useCanvasHover(
  hostRef: React.RefObject<HTMLDivElement>,
  tool: EditorTool,
  brush: BrushSettings,
  view: EditorView,
  isSpacePanning: boolean,
): CanvasHover {
  const cursor = useBrushCursor(tool, brush, view, isSpacePanning);
  const badge = useModeBadge();
  const info = useInfoReadout();

  const onHoverMove = useCallback(
    (e: React.PointerEvent<HTMLElement>): void => {
      cursor.moveCursor(e, hostRef.current);
      badge.updateBadge(e, hostRef.current);
      info.updateInfo(e, hostRef.current);
    },
    [badge, cursor, hostRef, info],
  );

  const onHoverLeave = useCallback((): void => {
    cursor.hideCursor();
    badge.hideBadge();
    info.hideInfo();
  }, [badge, cursor, info]);

  return {
    canvasCursor: cursor.canvasCursor,
    cursorRef: cursor.cursorRef,
    badgeRef: badge.badgeRef,
    infoRef: info.infoRef,
    onHoverMove,
    onHoverLeave,
  };
}
