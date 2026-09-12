import { useEffect, useRef, useState } from 'react';
import type { TextObject } from '../../core/scene';
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

export function useCanvasTextActions(
  session: CanvasTextSession,
  values: DialogValues,
  variables: CanvasTextVariables,
) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const busy = useRef(false);
  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );
  const cancel = (): void => finishSession(session);
  const save = async (): Promise<void> => {
    if (busy.current || !canvasTextSessionIsCurrent(session)) return;
    if (values.content.trim() === '') {
      cancel();
      return;
    }
    const token = ++request.current;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const object = await buildCanvasTextObject(session, values);
      if (request.current !== token || !canvasTextSessionIsCurrent(session)) return;
      if (!unchangedText(session.original, object) || variables.changed) {
        useStore.getState().upsertTextObject(object, values.importedFont, {
          placement: 'canvas',
          ...(variables.changed ? { variables: variables.variables } : {}),
        });
      }
      useStore.getState().selectObject(object.id);
      finishSession(session);
    } catch (cause) {
      if (canvasTextSessionIsCurrent(session)) setError(errorMessage(cause));
    } finally {
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

function unchangedText(original: TextObject | null, next: TextObject): boolean {
  if (original === null) return false;
  const keys = [
    'content',
    'fontKey',
    'sizeMm',
    'alignment',
    'lineHeight',
    'letterSpacing',
    'color',
  ] as const;
  return (
    keys.every((key) => original[key] === next[key]) &&
    (original.bendDeg ?? 0) === (next.bendDeg ?? 0) &&
    (original.weldOverlaps ?? false) === (next.weldOverlaps ?? false) &&
    JSON.stringify(original.pathText) === JSON.stringify(next.pathText) &&
    JSON.stringify(original.variableTemplate) === JSON.stringify(next.variableTemplate)
  );
}
