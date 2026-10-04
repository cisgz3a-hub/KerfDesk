import { FONT_REGISTRY } from '../../core/text';
import type { AppState } from '../state/store';
import type { RemoteControlOptions } from './types';
import { RemoteFault } from './fault';
import { publicIdentifier, workspaceProjection } from './projections';
import { validTextPatch } from './text-validation';

export function historyProjection(state: AppState) {
  return { canUndo: state.undoStack.length > 0, canRedo: state.redoStack.length > 0 };
}

export function workspaceReadProjection(state: AppState, options: RemoteControlOptions) {
  return {
    ...workspaceProjection(state, options.canShareArtwork?.() === true),
    history: historyProjection(state),
    capabilities: { touchEditing: state.project.machine?.kind !== 'cnc' },
    permissions: {
      canEdit: options.canWrite() && options.canEdit?.() !== false && state.pendingUndo === null,
      artworkSharingEnabled: options.canShareArtwork?.() === true,
    },
  };
}

export function fontsProjection(): Record<string, unknown> {
  const fonts = FONT_REGISTRY.slice(0, 200).map((font) => ({
    id: font.key,
    name: font.displayName,
    geometry: font.geometry,
    style: font.styleClass,
  }));
  return { fonts, total: FONT_REGISTRY.length, truncated: fonts.length < FONT_REGISTRY.length };
}

/** The ordinary workspace summary intentionally never includes the text source. */
export function textProjection(
  state: AppState,
  artworkId: string,
  options: RemoteControlOptions,
): Record<string, unknown> {
  if (options.canShareArtwork?.() !== true) throw new RemoteFault('unavailable');
  if (!publicIdentifier(artworkId)) throw new RemoteFault('unsupported_operation');
  const object = state.project.scene.objects.find((candidate) => candidate.id === artworkId);
  if (object === undefined) throw new RemoteFault('not_found');
  if (
    object.kind !== 'text' ||
    object.pathText !== undefined ||
    object.variableTemplate !== undefined
  )
    throw new RemoteFault('unsupported_operation');
  const data = {
    text: object.content,
    fontId: object.fontKey,
    fontSizeMm: object.sizeMm,
    alignment: object.alignment,
    lineHeight: object.lineHeight,
    letterSpacing: object.letterSpacing,
  };
  if (!publicIdentifier(object.fontKey) || !validTextPatch(data))
    throw new RemoteFault('unavailable');
  return { artworkId, ...data };
}
