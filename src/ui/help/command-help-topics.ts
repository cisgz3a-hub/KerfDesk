import type { CommandFamily, CommandId } from '../commands/command-types';
import { EDITING_TOOLS_COMMAND_HELP } from './editing-tools-command-help';
import { FILE_COMMAND_HELP } from './file-command-help';
import { MACHINE_MOVE_COMMAND_HELP } from './machine-move-command-help';
import { SETTINGS_COMMAND_HELP } from './settings-command-help';

export type CommandHelpTopic = {
  readonly family: CommandFamily;
  readonly tooltip: string;
};

export const COMMAND_HELP: Readonly<Record<CommandId, CommandHelpTopic>> = {
  'tools.ai-assistant': {
    family: 'tools',
    tooltip:
      'Configure an optional desktop AI connection. Review generated editable vector artwork or suggestions from your saved material library before applying anything.',
  },
  ...FILE_COMMAND_HELP,
  ...EDITING_TOOLS_COMMAND_HELP,
  ...MACHINE_MOVE_COMMAND_HELP,
  ...SETTINGS_COMMAND_HELP,
  'edit.undo': {
    family: 'edit',
    tooltip:
      'Undo the most recent scene edit. The arrow beside the Undo button lists the last 15 steps by name; pick one to undo back to just before it.',
  },
  'edit.redo': {
    family: 'edit',
    tooltip: 'Redo the last edit that was undone.',
  },
  'edit.select-all': {
    family: 'edit',
    tooltip: 'Select every object on the workspace.',
  },
  'edit.copy': {
    family: 'edit',
    tooltip: 'Copy the selected artwork to KerfDesk clipboard.',
  },
  'edit.cut': {
    family: 'edit',
    tooltip: 'Cut the selected artwork to KerfDesk clipboard.',
  },
  'edit.paste': {
    family: 'edit',
    tooltip: 'Paste copied artwork into the workspace.',
  },
  'edit.group': {
    family: 'edit',
    tooltip: 'Treat the selected artwork as one selection group.',
  },
  'edit.ungroup': {
    family: 'edit',
    tooltip: 'Remove grouping from the selected artwork.',
  },
  'edit.lock-selection': {
    family: 'edit',
    tooltip: 'Lock selected artwork so normal selection and transform tools skip it.',
  },
  'edit.unlock-all': {
    family: 'edit',
    tooltip: 'Unlock every locked object in the current project.',
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
  'tools.measure': {
    family: 'tools',
    tooltip: 'Measure distance, delta, and angle on the workspace.',
  },
  'tools.add-text': {
    family: 'tools',
    tooltip:
      'Click the canvas to type text. Click existing text to edit it directly on the canvas (T).',
  },
  'tools.registration-jig': {
    family: 'tools',
    tooltip:
      'Open the registration jig panel: create a burn-alignment box, center artwork, and pick the burn run.',
  },
  'tools.camera': {
    family: 'tools',
    tooltip:
      'Open the camera panel: machine or USB camera, lens calibration, bed alignment, workspace overlay, and trace-from-camera.',
  },
  'tools.place-board': {
    family: 'tools',
    tooltip:
      'Capture a rectangle from its corners or find a circle from four rim points, then verify and fine-adjust points on the drawn outline.',
  },
  'tools.box-generator': {
    family: 'tools',
    tooltip: 'Generate a finger-joint box as cut-ready panels.',
  },
  'tools.barcode': {
    family: 'tools',
    tooltip: 'Insert a QR Code, Data Matrix or 1D barcode as engravable outlines.',
  },
  'tools.box-fit-test': {
    family: 'tools',
    tooltip: 'Generate fit test strips to calibrate joint clearance.',
  },
  'tools.material-test': {
    family: 'tools',
    tooltip: 'Create a power and speed grid for finding material settings.',
  },
  'tools.interval-test': {
    family: 'tools',
    tooltip: 'Create an interval grid for tuning raster line spacing.',
  },
  'tools.scan-offset-test': {
    family: 'tools',
    tooltip: 'Create a bidirectional scan-offset calibration pattern.',
  },
  'tools.focus-test': {
    family: 'tools',
    tooltip: 'Create a Z-axis focus test pattern for verified controllable-Z profiles.',
  },
  'tools.optimization-settings': {
    family: 'tools',
    tooltip: 'Adjust path ordering and travel optimization for output.',
  },
  'tools.rotary-setup': {
    family: 'tools',
    tooltip: 'Configure and calibrate a roller or chuck rotary attachment.',
  },
  'tools.print-and-cut': {
    family: 'tools',
    tooltip: 'Register printed artwork to two measured machine points before cutting.',
  },
  'tools.labs': {
    family: 'tools',
    tooltip: 'Enable experimental machine workflows that are still being hardware-validated.',
  },
  'tools.adjust-image': {
    family: 'tools',
    tooltip: 'Tune brightness, contrast, gamma, and dithering for the selected image.',
  },
  'tools.edit-image': {
    family: 'tools',
    tooltip: 'Open the Image Studio to paint, erase, and edit selected areas of the image.',
  },
  'tools.apply-image-mask': {
    family: 'tools',
    tooltip:
      'Use selected closed vector geometry as a non-destructive mask for the selected image.',
  },
  'tools.crop-image': {
    family: 'tools',
    tooltip: 'Bake the selected image mask into pixels and crop the image bounds.',
  },
  'tools.remove-image-mask': {
    family: 'tools',
    tooltip: 'Remove the selected image mask without changing the original image pixels.',
  },
  'tools.save-processed-bitmap': {
    family: 'tools',
    tooltip: 'Save the selected image as the processed bitmap KerfDesk will engrave.',
  },
  'tools.trace-image': {
    family: 'tools',
    tooltip: 'Trace the selected bitmap into editable vector paths.',
  },
  'tools.retrace-original': {
    family: 'tools',
    tooltip: 'Re-open Trace Image from the original raster kept behind the selected trace.',
  },
  'tools.multi-file-trace': {
    family: 'tools',
    tooltip:
      'Trace multiple image files with one preset to standalone SVG, DXF, PDF, EPS or GeoJSON files without changing the workspace. The page is the image size or fits the artwork with a margin. Images with nothing to trace are skipped and listed.',
  },
  'tools.convert-to-path': {
    family: 'tools',
    tooltip: 'Bake selected vector artwork into plain path geometry for node editing and welding.',
  },
  'tools.weld': {
    family: 'tools',
    tooltip: 'Weld contours within each operation, preserving separate operations and settings.',
  },
  'tools.union-silhouette': {
    family: 'tools',
    tooltip: 'Combine closed shapes into one silhouette using a chosen result operation.',
  },
  'tools.join-paths': {
    family: 'tools',
    tooltip: 'Join nearby open endpoints with matching operations, colour and artwork settings.',
  },
  'tools.resize-joints': {
    family: 'tools',
    tooltip: 'Review straight receiving slots and notches against measured material thickness.',
  },
  'tools.prepare-stamp': {
    family: 'tools',
    tooltip: 'Prepare a mirrored stamp face and graded shoulders, then review the height map.',
  },
  'tools.subtract': {
    family: 'tools',
    tooltip: 'Cut the upper selected shapes out of the bottom-most one (boolean difference).',
  },
  'tools.intersect': {
    family: 'tools',
    tooltip: 'Keep only the area every selected shape shares (boolean intersection).',
  },
  'tools.exclude': {
    family: 'tools',
    tooltip: 'Keep everything except where the selected shapes overlap (boolean XOR).',
  },
  'tools.convert-to-bitmap': {
    family: 'tools',
    tooltip: 'Rasterize selected vector artwork into a bitmap image.',
  },
  'tools.fill-selection': {
    family: 'tools',
    tooltip: 'Move selected vector artwork to its own Fill layer.',
  },
  'tools.close-open-fill-contours': {
    family: 'tools',
    tooltip: 'Close selected Fill contours when their endpoints are already nearly touching.',
  },
  'tools.close-fill-contours-with-tolerance': {
    family: 'tools',
    tooltip: 'Review selected open Fill contours before closing a larger endpoint gap.',
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
  'arrange.break-apart': {
    family: 'arrange',
    tooltip:
      'Split selected imported SVG paths into separate objects. A trace splits into one object per shape, each keeping its holes.',
  },
  'arrange.array': {
    family: 'arrange',
    tooltip:
      'Create a grid, point-rotation, or circular array from selected artwork. A grid can space copies by the gap between them or the distance between centres, shift or mirror every other row or column, and build leftward or upward. A circle can cover part of a turn and centre on one selected object, which stays put.',
  },
  'arrange.quick-nest': {
    family: 'arrange',
    tooltip: 'Pack selected groups and objects deterministically without overlap.',
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
    // Machine-neutral: the same command serves laser and router projects
    // (ADR-101 §7); the noun-aware hover copy lives on the connection bar.
    tooltip: 'Open the browser serial picker and connect to the machine controller.',
  },
  'laser.disconnect': {
    family: 'laser',
    tooltip: 'Close the current serial connection when the machine is idle.',
  },
  'laser.home': {
    family: 'laser',
    tooltip: 'Send the controller homing command and wait for completion.',
  },
  'window.toggle-preview': {
    family: 'window',
    tooltip:
      'Open or close Preview. When no output exists, Preview explains how to make it visible.',
  },
  'window.toggle-layers-panel': {
    family: 'window',
    tooltip: 'Show or hide the Cuts / Layers panel to control the workspace width.',
  },
  'window.toggle-machine-panel': {
    family: 'window',
    tooltip: 'Show or hide the machine controls panel, including during a job.',
  },
  'window.toggle-side-panels': {
    family: 'window',
    tooltip: 'Show or hide both workspace side panels with F12, including during a job.',
  },
  'window.reset-layout': {
    family: 'window',
    tooltip: 'Restore both workspace side panels to their standard visible layout.',
  },
  'window.theme-light': {
    family: 'window',
    tooltip: 'Use the light workspace theme. This is how KerfDesk opens on every machine.',
  },
  'window.theme-dark': {
    family: 'window',
    tooltip: 'Use the dark workspace theme for the chrome and the workspace bed.',
  },
  'window.theme-system': {
    family: 'window',
    tooltip: 'Follow the light/dark setting of the operating system, and change with it.',
  },
  'window.fit-view': {
    family: 'window',
    tooltip: 'Fit the full machine bed into the workspace view.',
  },
  'window.project-notes': {
    family: 'window',
    tooltip: 'Edit notes saved inside the current KerfDesk project file.',
  },
  'window.undo-history': {
    family: 'window',
    tooltip:
      'Review the named undo and redo steps of the current project. Click an undo step to go back to just before it, or a redo step to redo through it.',
  },
  'help.about': {
    family: 'help',
    tooltip: 'Show KerfDesk build and version information.',
  },
  'help.licence': {
    family: 'help',
    tooltip:
      'See your Free or Pro edition, start the Pro trial, and manage your licence key, devices and updates.',
  },
  'help.check-updates': {
    family: 'help',
    tooltip:
      'See your installed version, check for a newer release, and follow the available download and installation choices. Updates never close KerfDesk while you work.',
  },
  'help.tutorials': {
    family: 'help',
    tooltip: 'Browse step-by-step visual tutorials for tools, artwork, and machine workflows.',
  },
  'help.connection': {
    family: 'help',
    tooltip: "Steps to fix a machine that won't connect, including USB driver help.",
  },
  'help.safety': {
    family: 'help',
    tooltip: 'Machine-safety and liability information — read before running a job.',
  },
  'help.report-bug': {
    family: 'help',
    tooltip: 'Open KerfDesk support in your browser and see what to include in a problem report.',
  },
  'help.support-report': {
    family: 'help',
    tooltip:
      'Save a text file with your KerfDesk version, machine, recent problems and, in the desktop app, its log. Read it, then email it to support@kerfdesk.com. It never includes your licence key.',
  },
  'help.open-data-folder': {
    family: 'help',
    tooltip:
      'Open the folder where the desktop app keeps your settings, licence and support log, for example to back it up or when KerfDesk support asks for a file from it. Your projects are saved wherever you choose, not here.',
  },
  'help.discussions': {
    family: 'help',
    tooltip: 'Open KerfDesk support in your browser for questions, ideas and feedback.',
  },
};
