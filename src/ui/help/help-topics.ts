import type { CommandFamily, CommandId } from '../commands/command-types';

export type CommandHelpId = `command:${CommandId}`;
export type MenuHelpId = `menu:${CommandFamily}`;
export type ToolHelpKey = 'select' | 'rect' | 'ellipse' | 'polygon' | 'polyline';
export type ToolHelpId = `tool:${ToolHelpKey}`;
export type ControlHelpKey =
  | 'laser.console'
  | 'laser.console.copy'
  | 'laser.console.clear'
  | 'laser.console.input'
  | 'laser.console.send'
  | 'laser.console.quick.$X'
  | 'laser.console.quick.$$'
  | 'laser.console.quick.$#'
  | 'laser.console.quick.$I'
  | 'laser.console.quick.$G'
  | 'laser.console.quick.?'
  | 'laser.machine-settings'
  | 'laser.machine-settings.read'
  | 'laser.machine-settings.export'
  | 'laser.machine-settings.table'
  | 'laser.output-scope.cut-selected'
  | 'laser.output-scope.selection-origin';
export type ControlHelpId = `control:${string}`;
export type HelpTopicId = CommandHelpId | MenuHelpId | ToolHelpId | ControlHelpId;

export type CommandHelpTopic = {
  readonly family: CommandFamily;
  readonly tooltip: string;
};

export type HelpTopic = {
  readonly label: string;
  readonly tooltip: string;
};

export const COMMAND_HELP: Readonly<Record<CommandId, CommandHelpTopic>> = {
  'file.new': {
    family: 'file',
    tooltip: 'Create a new blank project.',
  },
  'file.open': {
    family: 'file',
    tooltip: 'Open a saved LaserForge project file.',
  },
  'file.save': {
    family: 'file',
    tooltip: 'Save the current project to its existing file.',
  },
  'file.save-as': {
    family: 'file',
    tooltip: 'Save the current project as a new file.',
  },
  'file.import-svg': {
    family: 'file',
    tooltip: 'Import vector artwork from an SVG file.',
  },
  'file.import-image': {
    family: 'file',
    tooltip: 'Import a PNG or JPG image for engraving or tracing.',
  },
  'file.save-gcode': {
    family: 'file',
    tooltip: 'Export the current job as GRBL G-code.',
  },
  'edit.undo': {
    family: 'edit',
    tooltip: 'Undo the most recent scene edit.',
  },
  'edit.redo': {
    family: 'edit',
    tooltip: 'Redo the last edit that was undone.',
  },
  'edit.select-all': {
    family: 'edit',
    tooltip: 'Select every object on the workspace.',
  },
  'edit.duplicate': {
    family: 'edit',
    tooltip: 'Duplicate the selected artwork in place.',
  },
  'edit.delete': {
    family: 'edit',
    tooltip: 'Delete the selected artwork from the scene.',
  },
  'edit.clear-selection': {
    family: 'edit',
    tooltip: 'Clear the current selection and return to the workspace.',
  },
  'tools.add-text': {
    family: 'tools',
    tooltip: 'Create editable text artwork on the workspace.',
  },
  'tools.material-test': {
    family: 'tools',
    tooltip: 'Create a power and speed grid for finding material settings.',
  },
  'tools.interval-test': {
    family: 'tools',
    tooltip: 'Create an interval grid for tuning raster line spacing.',
  },
  'tools.optimization-settings': {
    family: 'tools',
    tooltip: 'Adjust path ordering and travel optimization for output.',
  },
  'tools.adjust-image': {
    family: 'tools',
    tooltip: 'Tune brightness, contrast, gamma, and dithering for the selected image.',
  },
  'tools.trace-image': {
    family: 'tools',
    tooltip: 'Trace the selected bitmap into editable vector paths.',
  },
  'tools.convert-to-bitmap': {
    family: 'tools',
    tooltip: 'Rasterize selected vector artwork into a bitmap image.',
  },
  'arrange.align-left': {
    family: 'arrange',
    tooltip: 'Align selected objects to the reference left edge.',
  },
  'arrange.align-center-x': {
    family: 'arrange',
    tooltip: 'Align selected objects to the reference vertical center.',
  },
  'arrange.align-right': {
    family: 'arrange',
    tooltip: 'Align selected objects to the reference right edge.',
  },
  'arrange.align-top': {
    family: 'arrange',
    tooltip: 'Align selected objects to the reference top edge.',
  },
  'arrange.align-center-y': {
    family: 'arrange',
    tooltip: 'Align selected objects to the reference horizontal center.',
  },
  'arrange.align-bottom': {
    family: 'arrange',
    tooltip: 'Align selected objects to the reference bottom edge.',
  },
  'arrange.align-centers': {
    family: 'arrange',
    tooltip: 'Center selected objects over the reference object.',
  },
  'arrange.distribute-horizontal-centers': {
    family: 'arrange',
    tooltip: 'Evenly space selected object centers horizontally.',
  },
  'arrange.distribute-horizontal-spacing': {
    family: 'arrange',
    tooltip: 'Evenly space selected object edges horizontally.',
  },
  'arrange.distribute-vertical-centers': {
    family: 'arrange',
    tooltip: 'Evenly space selected object centers vertically.',
  },
  'arrange.distribute-vertical-spacing': {
    family: 'arrange',
    tooltip: 'Evenly space selected object edges vertically.',
  },
  'arrange.flip-horizontal': {
    family: 'arrange',
    tooltip: 'Mirror the selected artwork horizontally around its center.',
  },
  'arrange.flip-vertical': {
    family: 'arrange',
    tooltip: 'Mirror the selected artwork vertically around its center.',
  },
  'laser.connect': {
    family: 'laser',
    tooltip: 'Open the browser serial picker and connect to the laser controller.',
  },
  'laser.disconnect': {
    family: 'laser',
    tooltip: 'Close the current laser serial connection when the machine is idle.',
  },
  'laser.home': {
    family: 'laser',
    tooltip: 'Send the controller homing command and wait for completion.',
  },
  'window.toggle-preview': {
    family: 'window',
    tooltip: 'Preview the exact toolpath that will be sent to the machine.',
  },
  'window.fit-view': {
    family: 'window',
    tooltip: 'Fit the full machine bed into the workspace view.',
  },
  'help.about': {
    family: 'help',
    tooltip: 'Show LaserForge build and version information.',
  },
};

export const TOOL_HELP: Readonly<Record<ToolHelpKey, HelpTopic>> = {
  select: {
    label: 'Select / transform',
    tooltip: 'Select, move, rotate, and resize existing artwork. Press Esc to return here.',
  },
  rect: {
    label: 'Draw rectangle',
    tooltip: 'Draw a rectangle by dragging on the workspace.',
  },
  ellipse: {
    label: 'Draw ellipse',
    tooltip: 'Draw an ellipse or circle by dragging on the workspace.',
  },
  polygon: {
    label: 'Draw polygon',
    tooltip: 'Draw a polygon by dragging to set its size on the workspace.',
  },
  polyline: {
    label: 'Draw polyline',
    tooltip: 'Draw connected line segments. Press Enter or double-click to finish.',
  },
};

export const MENU_HELP: Readonly<Record<CommandFamily, HelpTopic>> = {
  file: {
    label: 'File menu',
    tooltip: 'File menu for project, import, and G-code export actions.',
  },
  edit: {
    label: 'Edit menu',
    tooltip: 'Edit menu for undo, selection, duplicate, and delete actions.',
  },
  tools: {
    label: 'Tools menu',
    tooltip: 'Tools menu for creating, tracing, bitmap, and calibration actions.',
  },
  arrange: {
    label: 'Arrange menu',
    tooltip: 'Arrange menu for alignment, distribution, and flip actions.',
  },
  laser: {
    label: 'Laser menu',
    tooltip: 'Laser menu for connection and controller setup actions.',
  },
  window: {
    label: 'Window menu',
    tooltip: 'Window menu for preview and workspace view actions.',
  },
  help: {
    label: 'Help menu',
    tooltip: 'Help menu for LaserForge information and support actions.',
  },
};

export const CONTROL_HELP: Readonly<Record<ControlHelpKey, HelpTopic>> = {
  'laser.console': {
    label: 'GRBL console',
    tooltip: 'Inspect controller traffic and send guarded one-line GRBL diagnostics.',
  },
  'laser.console.copy': {
    label: 'Copy console',
    tooltip: 'Copy the visible console transcript to the clipboard.',
  },
  'laser.console.clear': {
    label: 'Clear console',
    tooltip: 'Clear the local console transcript without sending anything to the controller.',
  },
  'laser.console.input': {
    label: 'Console command',
    tooltip: 'Enter one GRBL or G-code command; multi-line macros are not sent here.',
  },
  'laser.console.send': {
    label: 'Send console command',
    tooltip: 'Send one validated command through the same guarded serial write path.',
  },
  'laser.console.quick.$X': {
    label: 'Unlock alarm',
    tooltip: 'Send $X to unlock GRBL only after confirming the machine is safe.',
  },
  'laser.console.quick.$$': {
    label: 'Read settings',
    tooltip: 'Send $$ to read GRBL settings and refresh the detected controller profile.',
  },
  'laser.console.quick.$#': {
    label: 'Read offsets',
    tooltip: 'Send $# to read GRBL coordinate offsets and active work coordinate state.',
  },
  'laser.console.quick.$I': {
    label: 'Controller info',
    tooltip: 'Send $I to request firmware build and controller identification details.',
  },
  'laser.console.quick.$G': {
    label: 'Modal state',
    tooltip: 'Send $G to request the active GRBL parser modal state.',
  },
  'laser.console.quick.?': {
    label: 'Status query',
    tooltip: 'Send realtime ? to request one immediate GRBL status report.',
  },
  'laser.machine-settings': {
    label: 'Machine Settings',
    tooltip: 'Read GRBL firmware settings and export a backup before changing controller setup.',
  },
  'laser.machine-settings.read': {
    label: 'Read machine settings',
    tooltip: 'Send $$ through the guarded serial path to read GRBL firmware settings.',
  },
  'laser.machine-settings.export': {
    label: 'Export machine settings backup',
    tooltip: 'Save the last read GRBL settings as a LaserForge backup JSON file.',
  },
  'laser.machine-settings.table': {
    label: 'Machine settings table',
    tooltip: 'Review each reported GRBL setting value, unit, and meaning without editing firmware.',
  },
  'laser.output-scope.cut-selected': {
    label: 'Cut Selected Graphics',
    tooltip:
      'Output only the currently selected artwork for preview, frame, start, and G-code export.',
  },
  'laser.output-scope.selection-origin': {
    label: 'Use Selection Origin',
    tooltip:
      'Calculate job origin from the selected artwork instead of the whole workspace design.',
  },
};

export function commandHelpId(id: CommandId): CommandHelpId {
  return `command:${id}`;
}

export function toolHelpId(id: ToolHelpKey): ToolHelpId {
  return `tool:${id}`;
}

export function menuHelpId(id: CommandFamily): MenuHelpId {
  return `menu:${id}`;
}

export function commandTitle(id: CommandId, fallback: string): string {
  return COMMAND_HELP[id]?.tooltip ?? fallback;
}

export function controlHelp(id: HelpTopicId, disabledReason?: string): string {
  const topic = topicById(id);
  const normal = topic?.tooltip ?? id;
  if (disabledReason === undefined || disabledReason.trim() === '') return normal;
  return `${disabledReason.trim()} ${normal}`;
}

export function helpProps(
  id: HelpTopicId,
  disabledReason?: string,
): { readonly title: string; readonly 'data-help-id': HelpTopicId } {
  return {
    title: controlHelp(id, disabledReason),
    'data-help-id': id,
  };
}

function topicById(id: HelpTopicId): HelpTopic | CommandHelpTopic | undefined {
  if (id.startsWith('command:')) {
    return COMMAND_HELP[id.slice('command:'.length) as CommandId];
  }
  if (id.startsWith('tool:')) {
    return TOOL_HELP[id.slice('tool:'.length) as ToolHelpKey];
  }
  if (id.startsWith('menu:')) {
    return MENU_HELP[id.slice('menu:'.length) as CommandFamily];
  }
  if (id.startsWith('control:')) {
    return CONTROL_HELP[id.slice('control:'.length) as ControlHelpKey];
  }
  return undefined;
}
