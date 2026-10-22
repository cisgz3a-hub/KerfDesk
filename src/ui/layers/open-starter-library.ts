import type { MaterialLibraryDocument } from '../../io/material-library';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';

// Starter Presets adds its library as Import adds one: it never replaces a
// saved library. Libraries save themselves with no undo, so writing the stock
// presets over a starter library the operator has changed would delete their
// presets. That library is kept, and a fresh copy opens beside it (ADR-093
// Amendment 1, audit 21-P1-1).
export function openStarterLibrary(starter: MaterialLibraryDocument): void {
  useStore.getState().importMaterialLibrary(starter);
  if (useStore.getState().materialLibrary?.libraryId === starter.libraryId) return;
  useToastStore
    .getState()
    .pushToast(
      `Opened a fresh copy of ${starter.name}. The copy you already had differs from it, so it is kept in Saved Libraries.`,
      'info',
    );
}
