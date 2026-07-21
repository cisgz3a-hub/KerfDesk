import type { CommandFamily, CommandId } from '../commands/command-types';
import { COMMAND_HELP, type CommandHelpTopic } from './command-help-topics';

export { COMMAND_HELP, type CommandHelpTopic } from './command-help-topics';

export type CommandHelpId = `command:${CommandId}`;
export type MenuHelpId = `menu:${CommandFamily}`;
export type ToolHelpKey =
  | 'select'
  | 'node'
  | 'measure'
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'polyline'
  | 'position-laser';
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
  | 'laser.detected-settings.review'
  | 'laser.detected-settings.dismiss'
  | 'laser.detected-settings.apply-safe'
  | 'laser.detected-settings.powered-z'
  | 'laser.machine-settings'
  | 'laser.machine-settings.read'
  | 'laser.machine-settings.diagnostic'
  | 'laser.machine-settings.export'
  | 'laser.machine-settings.export-diagnostic'
  | 'laser.machine-settings.table'
  | 'laser.machine-setup.launch'
  | 'laser.machine-setup.tab.overview'
  | 'laser.machine-setup.tab.catalog'
  | 'laser.machine-setup.tab.controller'
  | 'laser.machine-setup.tab.firmware'
  | 'laser.machine-setup.tab.zones'
  | 'laser.machine-setup.tab.raster-diagnostics'
  | 'laser.machine-setup.tab.import-export'
  | 'laser.device-setup.launch'
  | 'laser.device-setup.next'
  | 'laser.device-setup.back'
  | 'laser.device-setup.finish'
  | 'laser.device-setup.cancel'
  | 'laser.device-setup.connect'
  | 'laser.device-setup.reread'
  | 'laser.device-setup.apply-detected'
  | 'laser.output-scope.cut-selected'
  | 'laser.output-scope.selection-origin'
  | 'preview.showTraversalMoves'
  | 'preview.routePlayback'
  | 'preview.routeRestart'
  | 'preview.routeSpeed';
export type ControlHelpId = `control:${ControlHelpKey}`;
export type HelpTopicId = CommandHelpId | MenuHelpId | ToolHelpId | ControlHelpId;

export type HelpTopic = {
  readonly label: string;
  readonly tooltip: string;
};

export const TOOL_HELP: Readonly<Record<ToolHelpKey, HelpTopic>> = {
  'position-laser': {
    label: 'Move laser here',
    tooltip:
      'Click a point on the workspace (or the camera overlay) to move the laser head to that spot. Needs a connected, idle machine; the beam stays off.',
  },
  select: {
    label: 'Select / transform',
    tooltip:
      'Select, move, rotate, and resize artwork. Drag the center arrows to move a selection; Alt+click cycles crossing objects.',
  },
  node: {
    label: 'Edit nodes',
    tooltip: 'Edit vector path nodes without moving or resizing the whole object.',
  },
  measure: {
    label: 'Measure',
    tooltip: 'Measure distance, delta, and angle on the workspace. Hold Shift to snap the line.',
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
  star: {
    label: 'Draw star',
    tooltip: 'Draw a star by dragging to set its size on the workspace.',
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
    // Machine-neutral copy: this family renders as "Laser" or "Router"
    // depending on the project machine (ADR-101 §7); the help id stays
    // 'laser' because ids never rename.
    label: 'Machine menu',
    tooltip: 'Machine menu for connection and controller setup actions.',
  },
  window: {
    label: 'Window menu',
    tooltip: 'Window menu for preview and workspace view actions.',
  },
  help: {
    label: 'Help menu',
    tooltip: 'Help menu for KerfDesk information and support actions.',
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
  'laser.detected-settings.review': {
    label: 'Detected settings review',
    tooltip:
      'Review controller-reported GRBL settings before applying safe profile updates or capability hints.',
  },
  'laser.detected-settings.dismiss': {
    label: 'Dismiss detected settings',
    tooltip: 'Hide this detected-settings review without changing the active machine profile.',
  },
  'laser.detected-settings.apply-safe': {
    label: 'Apply safe detected settings',
    tooltip:
      'Apply only safe numeric GRBL profile values; firmware and machine capabilities are not changed.',
  },
  'laser.detected-settings.powered-z': {
    label: 'Mark powered Z',
    tooltip:
      'Mark the profile as having powered Z while keeping Z jog blocked until travel is confirmed.',
  },
  'laser.machine-settings': {
    label: 'Read / Backup Controller Settings',
    tooltip:
      'Read live GRBL firmware settings with $$ and export a backup before changing controller setup.',
  },
  'laser.machine-settings.read': {
    label: 'Read machine settings',
    tooltip: 'Send $$ through the guarded serial path to read GRBL firmware settings.',
  },
  'laser.machine-settings.diagnostic': {
    label: 'Run machine diagnostic',
    tooltip:
      'Send read-only GRBL probes for build info, settings, offsets, modal state, and status.',
  },
  'laser.machine-settings.export': {
    label: 'Export machine settings backup',
    tooltip: 'Save the last read GRBL settings as a KerfDesk backup JSON file.',
  },
  'laser.machine-settings.export-diagnostic': {
    label: 'Export machine diagnostic',
    tooltip:
      'Save a local JSON diagnostic with active profile, controller settings, stream state, and recent serial transcript.',
  },
  'laser.machine-settings.table': {
    label: 'Machine settings table',
    tooltip: 'Review each reported GRBL setting value, unit, and meaning without editing firmware.',
  },
  'laser.machine-setup.launch': {
    label: 'Machine Setup',
    tooltip:
      'Open the single step-by-step setup: machine type, profile and controller, connect and detect, confirm settings, options and calibration, then review and save.',
  },
  'laser.machine-setup.tab.overview': {
    label: 'Machine overview',
    tooltip:
      'Review the active machine profile, work area, capabilities, and current setup summary.',
  },
  'laser.machine-setup.tab.catalog': {
    label: 'Profile catalog',
    tooltip:
      'Choose a built-in GRBL machine profile or duplicate one before tuning machine-specific values.',
  },
  'laser.machine-setup.tab.controller': {
    label: 'Controller settings',
    tooltip: 'Read and search live GRBL controller settings without changing firmware values.',
  },
  'laser.machine-setup.tab.firmware': {
    label: 'Firmware writes',
    tooltip:
      'Write one guarded GRBL setting at a time only after review, confirmation, and a fresh backup.',
  },
  'laser.machine-setup.tab.zones': {
    label: 'Safety zones',
    tooltip:
      'Define machine-coordinate no-go zones that preflight checks before frame, start, or export.',
  },
  'laser.machine-setup.tab.raster-diagnostics': {
    label: 'Raster diagnostics',
    tooltip:
      'Check bidirectional raster and fill risks such as missing scan offsets, overscan, and laser mode.',
  },
  'laser.machine-setup.tab.import-export': {
    label: 'Import and export',
    tooltip:
      'Import, review, and export KerfDesk machine profiles or supported LightBurn device files.',
  },
  'laser.device-setup.launch': {
    label: 'Machine Setup',
    tooltip:
      'Configure machine type, profile, controller, coordinates, output, optional calibrations, and the guarded firmware review in one draft-based flow.',
  },
  'laser.device-setup.next': {
    label: 'Next step',
    tooltip: 'Continue to the next step of Machine Setup.',
  },
  'laser.device-setup.back': {
    label: 'Previous step',
    tooltip: 'Return to the previous step of Machine Setup.',
  },
  'laser.device-setup.finish': {
    label: 'Save machine setup',
    tooltip:
      'Atomically save the reviewed software configuration, then write and verify any explicitly queued common firmware settings.',
  },
  'laser.device-setup.cancel': {
    label: 'Cancel setup',
    tooltip:
      'Discard the complete Machine Setup draft. Queued firmware settings are not sent on Cancel.',
  },
  'laser.device-setup.connect': {
    label: 'Connect controller',
    tooltip:
      'Open the serial port with the controller family and baud chosen on the Choose your machine step.',
  },
  'laser.device-setup.reread': {
    label: 'Run read-only checks',
    tooltip: 'Run the selected controller family’s non-motion identity and settings-read commands.',
  },
  'laser.device-setup.apply-detected': {
    label: 'Apply detected settings',
    tooltip: 'Copy supported controller-reported values into the Machine Setup draft.',
  },
  'laser.output-scope.cut-selected': {
    label: 'Selected artwork only',
    tooltip:
      'Output only the currently selected artwork for preview, frame, start, and G-code export.',
  },
  'laser.output-scope.selection-origin': {
    label: 'Anchor from selected artwork',
    tooltip:
      'Position the job from the selected artwork bounds instead of the whole workspace design.',
  },
  'preview.showTraversalMoves': {
    label: 'Traversal moves',
    tooltip:
      'Show or hide laser-off traversal moves in the route preview without changing G-code output.',
  },
  'preview.routePlayback': {
    label: 'Route playback',
    tooltip: 'Play or pause the compressed route preview for the current output path.',
  },
  'preview.routeRestart': {
    label: 'Restart route preview',
    tooltip: 'Reset route preview playback to the beginning of the current output path.',
  },
  'preview.routeSpeed': {
    label: 'Route preview speed',
    tooltip: 'Choose how quickly the compressed route preview playback advances.',
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

export function isRegisteredHelpTopicId(id: string): id is HelpTopicId {
  return topicById(id as HelpTopicId) !== undefined;
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
