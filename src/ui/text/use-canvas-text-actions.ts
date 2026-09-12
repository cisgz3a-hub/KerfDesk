import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import {
  canvasTextSessionIsCurrent,
  useCanvasTextStore,
  type CanvasTextSession,
} from './canvas-text-store';
import { buildCanvasTextObject, errorMessage } from './use-canvas-text-draft';
import type { DialogValues } from './use-text-dialog-fields';
import type { CanvasTextVariables } from './use-canvas-text-variables';
import { assertCanvasTextGuideCurrent, canvasTextUnchanged } from './canvas-text-save-validation';

export function useCanvasTextActions(
  session: CanvasTextSession,
  values: DialogValues,
  variables: CanvasTextVariables,
) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const busy = useRef(false);
  const activeRender = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current += 1;
      activeRender.current?.abort();
    },
    [],
  );
  const cancel = (): void => {
    request.current += 1;
    activeRender.current?.abort();
    finishSession(session);
  };
  const save = async (): Promise<void> => {
    if (busy.current || !canvasTextSessionIsCurrent(session)) return;
    if (values.content.trim() === '') {
      cancel();
      return;
    }
    const token = ++request.current;
    const controller = new AbortController();
    const isCurrent = (): boolean =>
      !controller.signal.aborted &&
      request.current === token &&
      canvasTextSessionIsCurrent(session);
    activeRender.current = controller;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const object = await buildCanvasTextObject(session, values, controller.signal);
      if (!isCurrent()) return;
      assertCanvasTextGuideCurrent(values, useStore.getState().project);
      if (!canvasTextUnchanged(session.original, object) || variables.changed) {
        useStore.getState().upsertTextObject(object, values.importedFont, {
          placement: 'canvas',
          ...(variables.changed ? { variables: variables.variables } : {}),
        });
      }
      useStore.getState().selectObject(object.id);
      finishSession(session);
    } catch (cause) {
      if (isCurrent()) setError(errorMessage(cause));
    } finally {
      if (activeRender.current === controller) activeRender.current = null;
      busy.current = false;
      if (canvasTextSessionIsCurrent(session)) setSaving(false);
    }
  };
  return { saving, error, save, cancel, clearError: () => setError(null) };
}

function finishSession(session: CanvasTextSession): void {
  if (useCanvasTextStore.getState().session !== session) return;
  useCanvasTextStore.getState().close();
  if (useUiStore.getState().toolMode.kind === 'text') useUiStore.getState().resetToolMode();
}
