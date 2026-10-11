import { useRef } from 'react';
import { useStore } from '../state';
import { HIT_RADIUS_PX } from './design-hit-test';
import {
  handleAtPoint,
  RESIZE_HANDLE_GRAB_PX,
  resizeHandles,
  selectionBounds,
} from './design-handles';
import { pickDesignPhoto, type DesignPhotoActions } from './design-project-photos';
import { useDesignStudioStore } from './design-studio-store';
import type { DesignSurface } from './design-surface';
import type { DesignPointerHandlers } from './use-design-pointer';

/** Photo clicks must never create a sketch marquee or accidentally drag an old vector selection. */
export function useDesignPhotoPointer(
  surface: DesignSurface,
  pointer: DesignPointerHandlers,
  actions: DesignPhotoActions,
): DesignPointerHandlers {
  const photoGesture = useRef(false);
  const pick = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const session = useDesignStudioStore.getState().session;
    const point = surface.toMm(event);
    if (session?.tool !== 'select' || point === null) return null;
    const pxPerMm = surface.pxPerMm();
    // Selection grips extend beyond curved outlines and across gaps in a
    // multi-selection. They must retain the drawing pointer's first priority.
    const handles = resizeHandles(selectionBounds(session.history.present, session.selectedIds));
    if (handleAtPoint(handles, point, RESIZE_HANDLE_GRAB_PX / (pxPerMm > 0 ? pxPerMm : 1)) !== null)
      return null;
    return pickDesignPhoto(
      useStore.getState().project.scene,
      session.history.present,
      point,
      HIT_RADIUS_PX / Math.max(pxPerMm, Number.EPSILON),
    );
  };
  return {
    onPointerDown(event) {
      if (event.button !== 0) return pointer.onPointerDown(event);
      const photo = pick(event);
      photoGesture.current = photo !== null;
      actions.onSelectPhoto?.(photo?.id ?? null);
      if (photo === null) return pointer.onPointerDown(event);
      useDesignStudioStore.getState().setSelection([]);
      event.currentTarget.focus();
    },
    onPointerMove(event) {
      if (!photoGesture.current) pointer.onPointerMove(event);
    },
    onPointerUp(event) {
      if (photoGesture.current) {
        photoGesture.current = false;
        return;
      }
      pointer.onPointerUp(event);
    },
    onPointerLeave: pointer.onPointerLeave,
    onDoubleClick(event) {
      // React's double-click has the same position fields; mapping needs no pointer-only data.
      const photo = pick(event as React.PointerEvent<HTMLCanvasElement>);
      if (photo !== null) {
        event.preventDefault();
        actions.onEditPhoto?.(photo.id);
      } else pointer.onDoubleClick(event);
    },
  };
}
