import type { Layer } from '../../core/scene';
import type { MaterialLibraryDocument, MaterialPreset } from '../../io/material-library';

export type MaterialBindingStatus =
  | { readonly kind: 'library-unavailable'; readonly entry: null }
  | { readonly kind: 'preset-missing'; readonly entry: null }
  | { readonly kind: 'revision-untracked'; readonly entry: MaterialPreset }
  | { readonly kind: 'stale'; readonly entry: MaterialPreset }
  | { readonly kind: 'current'; readonly entry: MaterialPreset };

export function materialBindingStatus(
  binding: Layer['materialBinding'],
  library: MaterialLibraryDocument | null,
): MaterialBindingStatus | null {
  if (binding === undefined) return null;
  if (library === null || library.libraryId !== binding.libraryId) {
    return { kind: 'library-unavailable', entry: null };
  }
  const entry = library.entries.find((preset) => preset.id === binding.presetId);
  if (entry === undefined) return { kind: 'preset-missing', entry: null };
  if (binding.presetRevision === undefined) return { kind: 'revision-untracked', entry };
  if (binding.presetRevision !== entry.revision) return { kind: 'stale', entry };
  return { kind: 'current', entry };
}

export function materialBindingStatusText(
  binding: NonNullable<Layer['materialBinding']>,
  status: MaterialBindingStatus,
): string {
  switch (status.kind) {
    case 'library-unavailable':
      return 'Linked material library is unavailable. The saved settings snapshot remains active.';
    case 'preset-missing':
      return 'Linked material preset is missing. The saved settings snapshot remains active.';
    case 'revision-untracked':
      return `Linked preset revision was not recorded by this legacy project. The saved settings remain active; refresh explicitly to bind revision ${status.entry.revision}.`;
    case 'stale':
      return `Linked preset is stale: the layer uses revision ${binding.presetRevision ?? 'untracked'}, while the library has revision ${status.entry.revision}. Settings remain unchanged until explicit refresh.`;
    case 'current':
      return `Linked preset is current at revision ${status.entry.revision}.`;
  }
}
