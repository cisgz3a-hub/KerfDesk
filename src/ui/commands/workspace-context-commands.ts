import type { CommandId } from './command-registry';

export type WorkspaceContextKind = 'workspace-empty' | 'workspace-selection';

export function primaryWorkspaceContextCommands(
  context: WorkspaceContextKind,
): ReadonlyArray<CommandId> {
  return context === 'workspace-empty' ? EMPTY_PRIMARY_COMMANDS : SELECTION_PRIMARY_COMMANDS;
}

export function moreWorkspaceContextCommands(
  context: WorkspaceContextKind,
): ReadonlyArray<CommandId> {
  return context === 'workspace-empty' ? EMPTY_MORE_COMMANDS : SELECTION_MORE_COMMANDS;
}

const EMPTY_PRIMARY_COMMANDS: ReadonlyArray<CommandId> = [
  'edit.paste',
  'file.import-svg',
  'file.import-image',
  'tools.add-text',
  'window.toggle-preview',
  'window.fit-view',
];

const EMPTY_MORE_COMMANDS: ReadonlyArray<CommandId> = [
  'file.new',
  'file.open',
  'file.save',
  'file.save-as',
  'file.save-gcode',
  'tools.multi-file-trace',
];

const SELECTION_PRIMARY_COMMANDS: ReadonlyArray<CommandId> = [
  'edit.copy',
  'edit.cut',
  'edit.duplicate',
  'edit.delete',
  'edit.group',
  'edit.ungroup',
  'edit.lock-selection',
];

const SELECTION_MORE_COMMANDS: ReadonlyArray<CommandId> = [
  'edit.unlock-all',
  'arrange.align-left',
  'arrange.align-center-x',
  'arrange.align-right',
  'arrange.align-top',
  'arrange.align-center-y',
  'arrange.align-bottom',
  'arrange.align-centers',
  'arrange.distribute-horizontal-centers',
  'arrange.distribute-horizontal-spacing',
  'arrange.distribute-vertical-centers',
  'arrange.distribute-vertical-spacing',
  'arrange.flip-horizontal',
  'arrange.flip-vertical',
  'tools.adjust-image',
  'tools.apply-image-mask',
  'tools.crop-image',
  'tools.remove-image-mask',
  'tools.save-processed-bitmap',
  'tools.trace-image',
  'tools.convert-to-bitmap',
  'window.toggle-preview',
  'window.fit-view',
];
