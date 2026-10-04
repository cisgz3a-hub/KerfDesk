import type { AppState } from '../state/store';
import { bendTextRender, findFontEntry } from '../../core/text';
import type { TextObject } from '../../core/scene';
import { transformedBBox } from '../../core/scene/hit-test';
import { renderTextGeometry } from '../text/render-text-geometry';
import { applyTextWeldInWorker } from '../text/text-weld-worker-client';
import { editableArtwork } from './transforms';
import { remoteBounds } from './projections';
import { RemoteFault } from './fault';
import type { RemoteTextPatch } from './types';

export function editableText(state: AppState, artworkId: string): TextObject {
  const object = editableArtwork(state, [artworkId])[0];
  if (
    object?.kind !== 'text' ||
    object.pathText !== undefined ||
    object.variableTemplate !== undefined
  )
    throw new RemoteFault('unsupported_operation');
  return object;
}

export async function prepareTextEdit(
  state: AppState,
  object: TextObject,
  patch: RemoteTextPatch,
  signal: AbortSignal,
): Promise<{ readonly object: TextObject; readonly changedFields: readonly string[] }> {
  signal.throwIfAborted();
  const content = (patch.text ?? object.content).normalize('NFC');
  if (content.trim() === '' || content.length > 4096) throw new RemoteFault('invalid_arguments');
  const fontKey = patch.fontId ?? object.fontKey;
  checkTextFont(state, fontKey, patch.fontId !== undefined);
  const fields = nextTextFields(object, patch, content, fontKey);
  const previous = {
    text: object.content,
    fontId: object.fontKey,
    fontSizeMm: object.sizeMm,
    alignment: object.alignment,
    lineHeight: object.lineHeight,
    letterSpacing: object.letterSpacing,
  };
  const changedFields = (Object.keys(patch) as (keyof RemoteTextPatch)[]).filter(
    (key) => fields[key] !== previous[key],
  );
  if (changedFields.length === 0) return { object, changedFields };
  const rendered = await renderTextGeometry({
    fontKey,
    embeddedFonts: state.project.embeddedFonts,
    content,
    sizeMm: fields.fontSizeMm,
    alignment: fields.alignment,
    lineHeight: fields.lineHeight,
    letterSpacing: fields.letterSpacing,
    color: object.color,
  });
  signal.throwIfAborted();
  const final = await applyTextWeldInWorker(
    bendTextRender(rendered, object.bendDeg ?? 0),
    fontKey,
    object.weldOverlaps,
    signal,
  );
  signal.throwIfAborted();
  const next: TextObject = {
    ...object,
    content,
    fontKey,
    sizeMm: fields.fontSizeMm,
    alignment: fields.alignment,
    lineHeight: fields.lineHeight,
    letterSpacing: fields.letterSpacing,
    bounds: final.bounds,
    paths: final.paths.map((path, index) => {
      const operationIds = object.paths[index]?.operationIds;
      return operationIds === undefined ? path : { ...path, operationIds };
    }),
  };
  if (remoteBounds(transformedBBox(next)) === undefined)
    throw new RemoteFault('unsupported_operation');
  return { object: next, changedFields };
}

function nextTextFields(object: TextObject, patch: RemoteTextPatch, text: string, fontId: string) {
  return {
    text,
    fontId,
    fontSizeMm: patch.fontSizeMm ?? object.sizeMm,
    alignment: patch.alignment ?? object.alignment,
    lineHeight: patch.lineHeight ?? object.lineHeight,
    letterSpacing: patch.letterSpacing ?? object.letterSpacing,
  };
}

function checkTextFont(state: AppState, fontKey: string, selected: boolean): void {
  if (findFontEntry(fontKey) !== null) return;
  if (selected) throw new RemoteFault('invalid_arguments');
  if (!state.project.embeddedFonts?.some((font) => font.key === fontKey))
    throw new RemoteFault('unsupported_operation');
}
