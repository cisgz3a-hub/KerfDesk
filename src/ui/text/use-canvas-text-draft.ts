import { useEffect, useMemo, useRef, useState } from 'react';
import { IDENTITY_TRANSFORM, type TextObject } from '../../core/scene';
import { buildTextObject } from './build-text-object';
import {
  canvasTextSessionIsCurrent,
  useCanvasTextStore,
  type CanvasTextSession,
} from './canvas-text-store';
import type { DialogValues } from './use-text-dialog-fields';

export type TextDraftResult = {
  readonly object: TextObject | null;
  readonly pending: boolean;
  readonly error: string | null;
};

export function useCanvasTextDraft(session: CanvasTextSession, values: DialogValues) {
  const stableValues = useStableTextValues(values);
  const [result, setResult] = useState<TextDraftResult>({
    object: null,
    pending: true,
    error: null,
  });
  const revision = useRef(0);
  useEffect(() => {
    const token = ++revision.current;
    const controller = new AbortController();
    let active = true;
    const isCurrent = (): boolean =>
      active && revision.current === token && canvasTextSessionIsCurrent(session);
    const empty = stableValues.content.trim() === '';
    setResult((previous) => ({
      object: empty ? null : previous.object,
      pending: !empty,
      error: null,
    }));
    if (empty) useCanvasTextStore.getState().setDraft(session, null);
    // Coalesce fast typing and IME updates; only the latest input can settle.
    const timer = window.setTimeout(() => {
      if (stableValues.content.trim() === '') return;
      void buildCanvasTextObject(session, stableValues, controller.signal).then(
        (object) => {
          if (!isCurrent()) return;
          useCanvasTextStore.getState().setDraft(session, object);
          setResult({ object, pending: false, error: null });
        },
        (error: unknown) => {
          if (!isCurrent()) return;
          useCanvasTextStore.getState().setDraft(session, null);
          setResult({ object: null, pending: false, error: errorMessage(error) });
        },
      );
    }, 60);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [session, stableValues]);
  return result;
}

export async function buildCanvasTextObject(
  session: CanvasTextSession,
  values: DialogValues,
  signal?: AbortSignal,
): Promise<TextObject> {
  const object = await buildTextObject(session.state, values, signal);
  const original = session.original;
  return {
    ...object,
    id: original?.id ?? session.id,
    ...(original?.operationIds === undefined ? {} : { operationIds: original.operationIds }),
    ...(original?.operationOverride === undefined
      ? {}
      : { operationOverride: original.operationOverride }),
    paths: object.paths.map((path, index) => {
      const operationIds = original?.paths[index]?.operationIds;
      return operationIds === undefined ? path : { ...path, operationIds };
    }),
    // A path has its own world-space placement. Ordinary text keeps the
    // reviewed translation, rotation, scale and mirrors throughout editing.
    transform:
      object.pathText !== undefined
        ? object.transform
        : (original?.transform ?? { ...IDENTITY_TRANSFORM, ...session.position }),
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function useStableTextValues(values: DialogValues): DialogValues {
  const {
    content,
    fontKey,
    sizeMm,
    alignment,
    lineHeight,
    letterSpacing,
    bendDeg,
    weldOverlaps,
    color,
    embeddedFonts,
    importedFont,
    pathGuide,
  } = values;
  const variableEnabled = values.variableTemplate !== undefined;
  const guideObjectId = values.pathText?.guideObjectId;
  const offsetMm = values.pathText?.offsetMm ?? 0;
  const reverse = values.pathText?.reverse ?? false;
  return useMemo(
    () => ({
      content,
      fontKey,
      sizeMm,
      alignment,
      lineHeight,
      letterSpacing,
      bendDeg,
      ...(weldOverlaps === undefined ? {} : { weldOverlaps }),
      color,
      embeddedFonts,
      ...(importedFont === undefined ? {} : { importedFont }),
      ...(pathGuide === undefined ? {} : { pathGuide }),
      ...(guideObjectId === undefined ? {} : { pathText: { guideObjectId, offsetMm, reverse } }),
      ...(variableEnabled ? { variableTemplate: { tokens: [] } } : {}),
    }),
    [
      content,
      fontKey,
      sizeMm,
      alignment,
      lineHeight,
      letterSpacing,
      bendDeg,
      weldOverlaps,
      color,
      embeddedFonts,
      importedFont,
      pathGuide,
      guideObjectId,
      offsetMm,
      reverse,
      variableEnabled,
    ],
  );
}
