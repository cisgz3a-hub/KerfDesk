import type { CncLayerSettings } from '../../core/scene';

/** Copies artwork-owned CNC values while retaining the destination's Startup bindings. */
export function cncSettingsForArtworkPaste(
  copied: CncLayerSettings,
  destination: CncLayerSettings | undefined,
): CncLayerSettings {
  const {
    feedSource: _feedSource,
    materialKey: _materialKey,
    toolId: _toolId,
    vClearToolId: _vClearToolId,
    pocketRoughToolId: _pocketRoughToolId,
    reliefFinishToolId: _reliefFinishToolId,
    ...artwork
  } = copied;
  return { ...artwork, ...setupOwnedBindings(destination) };
}

function setupOwnedBindings(settings: CncLayerSettings | undefined): Partial<CncLayerSettings> {
  if (settings === undefined) return {};
  return {
    ...(settings.materialKey === undefined ? {} : { materialKey: settings.materialKey }),
    ...(settings.toolId === undefined ? {} : { toolId: settings.toolId }),
    ...(settings.vClearToolId === undefined ? {} : { vClearToolId: settings.vClearToolId }),
    ...(settings.pocketRoughToolId === undefined
      ? {}
      : { pocketRoughToolId: settings.pocketRoughToolId }),
    ...(settings.reliefFinishToolId === undefined
      ? {}
      : { reliefFinishToolId: settings.reliefFinishToolId }),
  };
}
