import { applyEditsBatch } from './design-batch';
import { addSvg, importFile } from './design-imports';
import {
  applyMaterialRecipe,
  assignArtworkToOperation,
  createOperation,
  deleteOperation,
  reorderOperation,
} from './design-operations';
import { saveProjectRemotely } from './design-save';
import type { DesignWrite } from './design-validation';
import type { RemoteAppStore, RemoteControlOptions } from './types';

type Commit = (action: () => Record<string, unknown>) => Record<string, unknown>;

/** ADR-584 design control. Every mutation still passes the adapter's revision/request fence. */
export async function applyDesignWrite(
  write: DesignWrite,
  store: RemoteAppStore,
  options: RemoteControlOptions,
  signal: AbortSignal,
  assertCurrent: () => void,
  commit: Commit,
): Promise<Record<string, unknown>> {
  assertCurrent();
  switch (write.command) {
    case 'create_operation':
      return commit(() => createOperation(store, write.args));
    case 'assign_artwork_to_operation':
      return commit(() => assignArtworkToOperation(store, write.args));
    case 'reorder_operation':
      return commit(() => reorderOperation(store, write.args));
    case 'delete_operation':
      return commit(() => deleteOperation(store, write.args));
    case 'apply_material_recipe':
      return commit(() => applyMaterialRecipe(store, write.args));
    case 'add_svg':
      return addSvg(store, write.args, signal, commit);
    case 'import_file':
      return importFile(store, write.args, signal, commit);
    case 'save_project':
      return saveProjectRemotely(store, options.getPlatform?.() ?? null, commit);
    case 'apply_edits':
      return applyEditsBatch(write.args.edits, store, signal, assertCurrent, commit);
  }
}
