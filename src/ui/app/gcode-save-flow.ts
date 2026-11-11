// Save G-code from the click to the file dialog (annoyance audit A4-P2-4,
// ADR-656 Amendment 4).
//
// The export is still built in full before any destination is chosen
// (ADR-656). What changed is what the operator has to do while it builds:
//
// - Ready while the click or key press is still active: the file dialog opens
//   at once. A save that is ready within PREPARING_DIALOG_DELAY_MS shows no
//   dialog of ours at all.
// - Still preparing after that delay: the Save G-code dialog appears with its
//   progress and Cancel. If the export is ready before the activation lapses,
//   the file dialog still opens on its own.
// - Ready only after the activation lapsed: the dialog asks for one click on
//   Save as…, because the picker cannot open without one.
// - A CNC export keeps its dialog whenever it is ready: Save as… or the setup
//   sheet package is a real choice.
// - A refusal is shown once: in the dialog when it is open, else as one toast.

import { create } from 'zustand';
import { errorMessage } from '../../core/util/error-message';
import type { OutputCompilationProgress } from '../../io/gcode/prepare-output-async';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { recordCncPreparation } from '../state/cnc-preparation-evidence-store';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { GCODE_SAVE_REFUSED, pushExportRefusal } from './export-refusal';
import { handleSaveGcode, type PrebuiltGcodeSave, type SaveGcodeCtx } from './file-actions';
import { hasPickerActivation, PREPARING_DIALOG_DELAY_MS } from './pick-prepared-save-target';
import { currentSaveGcodeContext } from './save-gcode-context';
import {
  prebuildGcodeSaveResult,
  prebuiltSaveOffersSetupSheet,
  type GcodeSavePrebuild,
} from './transactional-gcode-save';

export type GcodeSaveFlow =
  /** Running with nothing of its own to show: the first moments of a save, an
   * open file dialog, or a tiled or controller-specific save's own steps. */
  | { readonly kind: 'working' }
  | {
      readonly kind: 'preparing';
      readonly progress: OutputCompilationProgress | null;
      readonly cancel: () => void;
    }
  | {
      readonly kind: 'ready';
      readonly ctx: SaveGcodeCtx;
      readonly artifact: PrebuiltGcodeSave;
      readonly save: () => void;
      readonly close: () => void;
    }
  /** The file dialog opened from a visible Save G-code dialog. */
  | { readonly kind: 'choosing' }
  | {
      readonly kind: 'refused';
      readonly reasons: ReadonlyArray<string>;
      readonly close: () => void;
    };

type GcodeSaveFlowState = { readonly flow: GcodeSaveFlow | null };

export const useGcodeSaveFlowStore = create<GcodeSaveFlowState>(() => ({ flow: null }));

export type GcodeSaveDeps = {
  readonly platform: PlatformAdapter;
  readonly pushToast: SaveGcodeCtx['pushToast'];
};

/** The one line a tiled or controller-specific save shows while it prepares. */
export const EXPORT_PREPARING_TOAST_KEY = 'export-preparing';

function setFlow(flow: GcodeSaveFlow | null): void {
  useGcodeSaveFlowStore.setState({ flow });
}

/** File > Save G-code, Ctrl+Shift+E and the toolbar button. One save at a
 * time: a second request while one is under way is ignored. */
export function startGcodeSave(deps: GcodeSaveDeps): void {
  if (useGcodeSaveFlowStore.getState().flow !== null) return;
  const ctx = saveContext(deps);
  setFlow({ kind: 'working' });
  void saveFromClick(ctx).catch((error: unknown) => {
    // Nothing may leave the flow claimed: that would swallow every later save.
    setFlow(null);
    ctx.pushToast(`Could not save G-code: ${errorMessage(error)}`, 'error');
  });
}

// The stores as they stand at the click, so the file holds what the operator
// saw when they asked for it.
function saveContext(deps: GcodeSaveDeps): SaveGcodeCtx {
  const app = useStore.getState();
  return {
    ...currentSaveGcodeContext({ ...deps, app, laser: useLaserStore.getState() }),
    advanceVariablesAfter: app.advanceVariablesAfter,
  };
}

async function saveFromClick(ctx: SaveGcodeCtx): Promise<void> {
  const controller = new AbortController();
  let shown = false;
  let progress: OutputCompilationProgress | null = null;
  const cancel = (): void => {
    controller.abort();
    setFlow(null);
  };
  const showPreparing = (): void => {
    if (controller.signal.aborted) return;
    shown = true;
    setFlow({ kind: 'preparing', progress, cancel });
  };
  const timer = setTimeout(showPreparing, PREPARING_DIALOG_DELAY_MS);
  let result: GcodeSavePrebuild;
  try {
    result = await prebuildGcodeSaveResult(ctx, {
      signal: controller.signal,
      onProgress: (next) => {
        progress = next;
        if (shown) showPreparing();
      },
    });
  } catch (error) {
    if (controller.signal.aborted) return;
    result = { kind: 'refused', reasons: [`Preparation failed: ${errorMessage(error)}`] };
  } finally {
    clearTimeout(timer);
  }
  // Cancel already closed the dialog; a finished preparation is dropped.
  if (controller.signal.aborted) return;
  finishPreparation(ctx, result, shown);
}

function finishPreparation(ctx: SaveGcodeCtx, result: GcodeSavePrebuild, shown: boolean): void {
  if (result.kind === 'not-ordinary') {
    // Tiled CNC sets choose their folder first, and a controller-specific file
    // asks for its destination once it is compiled (ADR-656): neither needs
    // this dialog in front of it.
    writeFromFlow(ctx, undefined, false);
    return;
  }
  if (result.kind === 'refused') {
    refuse(ctx, result.reasons, shown);
    return;
  }
  const artifact = result.artifact;
  recordCncPreparation(artifact.project, ctx.outputScope, 'Export');
  if (prebuiltSaveOffersSetupSheet(artifact) || !hasPickerActivation()) {
    setFlow({
      kind: 'ready',
      ctx,
      artifact,
      save: () => writeFromFlow(ctx, artifact, true),
      close: () => setFlow(null),
    });
    return;
  }
  writeFromFlow(ctx, artifact, shown);
}

function refuse(ctx: SaveGcodeCtx, reasons: ReadonlyArray<string>, shown: boolean): void {
  if (shown) {
    setFlow({ kind: 'refused', reasons, close: () => setFlow(null) });
    return;
  }
  setFlow(null);
  pushExportRefusal(ctx.pushToast, GCODE_SAVE_REFUSED, reasons);
}

// The picker opens inside handleSaveGcode with no real wait before it, so the
// activation checked above is the one the picker sees.
function writeFromFlow(
  ctx: SaveGcodeCtx,
  artifact: PrebuiltGcodeSave | undefined,
  dialogOpen: boolean,
): void {
  setFlow({ kind: dialogOpen ? 'choosing' : 'working' });
  // A tiled or controller-specific save compiles inside its own steps, with no
  // dialog of ours on screen, so a slow one says that it is working.
  const stillPreparing =
    artifact === undefined
      ? setTimeout(() => {
          ctx.pushToast('Preparing the export…', 'info', { key: EXPORT_PREPARING_TOAST_KEY });
        }, PREPARING_DIALOG_DELAY_MS)
      : undefined;
  void handleSaveGcode(ctx, artifact === undefined ? {} : { prebuilt: artifact })
    .catch((error: unknown) => {
      ctx.pushToast(`Could not save G-code: ${errorMessage(error)}`, 'error');
    })
    .finally(() => {
      clearTimeout(stillPreparing);
      useToastStore.getState().dismissToastKey(EXPORT_PREPARING_TOAST_KEY);
      setFlow(null);
    });
}
