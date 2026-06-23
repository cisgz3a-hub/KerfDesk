// command-types — the command registry's shared shapes plus the
// enabled()/disabled() constructors. Split from command-registry.ts when
// it hit the 400-line cap; a third file (not two) so command-registry ->
// command-families -> command-types stays acyclic (import/no-cycle).

import type { SelectionAlignKind, SelectionDistributeKind } from '../../core/scene';
import { commandHelpId, commandTitle, controlHelp } from '../help/help-topics';

export const COMMAND_FAMILY_ORDER = [
  'file',
  'edit',
  'tools',
  'arrange',
  'laser',
  'window',
  'help',
] as const;

export type CommandFamily = (typeof COMMAND_FAMILY_ORDER)[number];

export type CommandId =
  | 'file.new'
  | 'file.open'
  | 'file.save'
  | 'file.save-as'
  | 'file.import-svg'
  | 'file.import-image'
  | 'file.save-gcode'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.select-all'
  | 'edit.copy'
  | 'edit.cut'
  | 'edit.paste'
  | 'edit.group'
  | 'edit.ungroup'
  | 'edit.lock-selection'
  | 'edit.unlock-all'
  | 'edit.duplicate'
  | 'edit.delete'
  | 'edit.clear-selection'
  | 'tools.add-text'
  | 'tools.material-test'
  | 'tools.interval-test'
  | 'tools.scan-offset-test'
  | 'tools.focus-test'
  | 'tools.optimization-settings'
  | 'tools.adjust-image'
  | 'tools.apply-image-mask'
  | 'tools.crop-image'
  | 'tools.remove-image-mask'
  | 'tools.save-processed-bitmap'
  | 'tools.trace-image'
  | 'tools.multi-file-trace'
  | 'tools.convert-to-bitmap'
  | 'tools.fill-selection'
  | 'tools.close-open-fill-contours'
  | 'tools.close-fill-contours-with-tolerance'
  | 'arrange.align-left'
  | 'arrange.align-center-x'
  | 'arrange.align-right'
  | 'arrange.align-top'
  | 'arrange.align-center-y'
  | 'arrange.align-bottom'
  | 'arrange.align-centers'
  | 'arrange.distribute-horizontal-centers'
  | 'arrange.distribute-horizontal-spacing'
  | 'arrange.distribute-vertical-centers'
  | 'arrange.distribute-vertical-spacing'
  | 'arrange.break-apart'
  | 'arrange.flip-horizontal'
  | 'arrange.flip-vertical'
  | 'laser.connect'
  | 'laser.disconnect'
  | 'laser.home'
  | 'window.toggle-preview'
  | 'window.fit-view'
  | 'window.project-notes'
  | 'help.about';

export type AppCommand = {
  readonly id: CommandId;
  readonly family: CommandFamily;
  readonly label: string;
  readonly title: string;
  readonly shortcut?: string;
  readonly enabled: boolean;
  readonly disabledReason?: string;
  // Toggle commands (Preview): surfaces render aria-pressed from this so
  // the on/off state is visible in the toolbar (M27).
  readonly active?: boolean;
  readonly invoke: () => void;
};

export type AppCommandContext = {
  readonly dirty: boolean;
  readonly savedName: string | null;
  readonly serialSupported: boolean;
  readonly connected: boolean;
  readonly machineBusy: boolean;
  readonly homingEnabled: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly hasSelection: boolean;
  readonly hasRasterSelection: boolean;
  readonly hasConvertibleSelection: boolean;
  readonly hasFillableSelection: boolean;
  readonly canCloseOpenFillContours: boolean;
  readonly canReviewCloseOpenFillContours: boolean;
  readonly canApplyImageMask: boolean;
  readonly hasMaskedRasterSelection: boolean;
  readonly canPaste: boolean;
  readonly canGroupSelection: boolean;
  readonly canUngroupSelection: boolean;
  readonly canLockSelection: boolean;
  readonly hasLockedObjects: boolean;
  // LU18 dirty-project guard: resolves true when the destructive action
  // may proceed (clean, saved, or explicitly discarded). Async because it
  // can show the Save / Don't Save / Cancel dialog and run a save.
  readonly confirmDiscard: (action: string) => Promise<boolean>;
  readonly newProject: () => void;
  readonly openProject: () => void;
  readonly saveProject: () => void;
  readonly saveProjectAs: () => void;
  readonly importSvg: () => void;
  readonly importImage: () => void;
  readonly saveGcode: () => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly selectAll: () => void;
  readonly copySelection: () => void;
  readonly cutSelection: () => void;
  readonly pasteClipboard: () => void;
  readonly groupSelection: () => void;
  readonly ungroupSelection: () => void;
  readonly lockSelection: () => void;
  readonly unlockAllObjects: () => void;
  readonly duplicateSelection: () => void;
  readonly deleteSelection: () => void;
  readonly clearSelection: () => void;
  readonly addText: () => void;
  readonly materialTest: () => void;
  readonly intervalTest: () => void;
  readonly scanOffsetTest: () => void;
  readonly focusTestAvailable: boolean;
  readonly focusTest: () => void;
  readonly optimizationSettings: () => void;
  readonly adjustImage: () => void;
  readonly saveProcessedBitmap: () => void;
  readonly traceImage: () => void;
  readonly multiFileTrace: () => void;
  readonly convertToBitmap: () => void;
  readonly fillSelectionSeparately: () => void;
  readonly closeSelectedOpenFillContours: () => void;
  readonly reviewCloseOpenFillContours: () => void;
  readonly applyImageMask: () => void;
  readonly cropImage: () => void;
  readonly removeImageMask: () => void;
  readonly canTransformSelection: boolean;
  readonly canAlignSelection: boolean;
  readonly alignSelection: (kind: SelectionAlignKind) => void;
  readonly canDistributeSelection: boolean;
  readonly distributeSelection: (kind: SelectionDistributeKind) => void;
  readonly canBreakApartSelection: boolean;
  readonly breakApartSelection: () => void;
  readonly flipHorizontal: () => void;
  readonly flipVertical: () => void;
  readonly connectLaser: () => void;
  readonly disconnectLaser: () => void;
  readonly homeLaser: () => void;
  readonly togglePreview: () => void;
  readonly previewActive: boolean;
  readonly hasPreviewableContent: boolean;
  readonly resetView: () => void;
  readonly projectNotes: () => void;
  readonly showAbout: () => void;
};

export function enabled(
  id: CommandId,
  family: CommandFamily,
  label: string,
  title: string,
  invoke: () => void,
  shortcut?: string,
): AppCommand {
  return {
    id,
    family,
    label,
    title: commandTitle(id, title),
    enabled: true,
    invoke,
    ...(shortcut ? { shortcut } : {}),
  };
}

export function disabled(
  id: CommandId,
  family: CommandFamily,
  label: string,
  reason: string,
  invoke: () => void,
  shortcut?: string,
): AppCommand {
  return {
    id,
    family,
    label,
    title: controlHelp(commandHelpId(id), reason),
    enabled: false,
    disabledReason: reason,
    invoke,
    ...(shortcut ? { shortcut } : {}),
  };
}
