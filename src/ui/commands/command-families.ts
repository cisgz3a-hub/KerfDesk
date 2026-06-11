// command-families — the per-menu-family command builders consumed by
// buildAppCommands. Pure functions of AppCommandContext.

import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';

export function fileCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    enabled(
      'file.new',
      'file',
      'New',
      'New project',
      () => {
        void ctx.confirmDiscard('start a new project').then((ok) => {
          if (ok) ctx.newProject();
        });
      },
      'Ctrl+N',
    ),
    enabled('file.open', 'file', 'Open...', 'Open .lf2 project', ctx.openProject, 'Ctrl+O'),
    enabled('file.save', 'file', 'Save', 'Save project', ctx.saveProject, 'Ctrl+S'),
    enabled(
      'file.save-as',
      'file',
      'Save As...',
      'Save project as',
      ctx.saveProjectAs,
      'Ctrl+Shift+S',
    ),
    enabled('file.import-svg', 'file', 'Import SVG...', 'Import SVG file', ctx.importSvg, 'Ctrl+I'),
    enabled(
      'file.import-image',
      'file',
      'Import Image...',
      'Import PNG/JPG image',
      ctx.importImage,
    ),
    enabled('file.save-gcode', 'file', 'Save G-code...', 'Export G-code', ctx.saveGcode, 'Ctrl+E'),
  ];
}

export function editCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  const duplicate = ctx.hasSelection
    ? enabled(
        'edit.duplicate',
        'edit',
        'Duplicate',
        'Duplicate selection',
        ctx.duplicateSelection,
        'Ctrl+D',
      )
    : disabled(
        'edit.duplicate',
        'edit',
        'Duplicate',
        'Select an object to duplicate.',
        ctx.duplicateSelection,
        'Ctrl+D',
      );
  return [
    ctx.canUndo
      ? enabled('edit.undo', 'edit', 'Undo', 'Undo last edit', ctx.undo, 'Ctrl+Z')
      : disabled('edit.undo', 'edit', 'Undo', 'Nothing to undo.', ctx.undo, 'Ctrl+Z'),
    ctx.canRedo
      ? enabled('edit.redo', 'edit', 'Redo', 'Redo last undone edit', ctx.redo, 'Ctrl+Shift+Z')
      : disabled('edit.redo', 'edit', 'Redo', 'Nothing to redo.', ctx.redo, 'Ctrl+Shift+Z'),
    enabled('edit.select-all', 'edit', 'Select All', 'Select all artwork', ctx.selectAll, 'Ctrl+A'),
    duplicate,
    ctx.hasSelection
      ? enabled('edit.delete', 'edit', 'Delete', 'Delete selection', ctx.deleteSelection, 'Delete')
      : disabled(
          'edit.delete',
          'edit',
          'Delete',
          'Select an object to delete.',
          ctx.deleteSelection,
          'Delete',
        ),
    enabled(
      'edit.clear-selection',
      'edit',
      'Clear Selection',
      'Clear current selection',
      ctx.clearSelection,
      'Esc',
    ),
  ];
}

export function toolsCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    enabled('tools.add-text', 'tools', 'Text...', 'Add text to the scene', ctx.addText),
    enabled(
      'tools.material-test',
      'tools',
      'Material Test...',
      'Create a material test grid',
      () => {
        void ctx.confirmDiscard('create a material test').then((ok) => {
          if (ok) ctx.materialTest();
        });
      },
    ),
    enabled(
      'tools.interval-test',
      'tools',
      'Interval Test...',
      'Create an interval test grid',
      () => {
        void ctx.confirmDiscard('create an interval test').then((ok) => {
          if (ok) ctx.intervalTest();
        });
      },
    ),
    enabled(
      'tools.optimization-settings',
      'tools',
      'Optimization Settings...',
      'Adjust output path optimization',
      ctx.optimizationSettings,
    ),
    ctx.hasRasterSelection
      ? enabled(
          'tools.adjust-image',
          'tools',
          'Adjust Image...',
          'Adjust selected image',
          ctx.adjustImage,
        )
      : disabled(
          'tools.adjust-image',
          'tools',
          'Adjust Image...',
          'Select an image first.',
          ctx.adjustImage,
        ),
    ctx.hasRasterSelection
      ? enabled(
          'tools.trace-image',
          'tools',
          'Trace Image...',
          'Trace selected image',
          ctx.traceImage,
        )
      : disabled(
          'tools.trace-image',
          'tools',
          'Trace Image...',
          'Select an image first.',
          ctx.traceImage,
        ),
    ctx.hasConvertibleSelection
      ? enabled(
          'tools.convert-to-bitmap',
          'tools',
          'Convert to Bitmap...',
          'Convert selected vector into a bitmap',
          ctx.convertToBitmap,
        )
      : disabled(
          'tools.convert-to-bitmap',
          'tools',
          'Convert to Bitmap...',
          'Select a vector first.',
          ctx.convertToBitmap,
        ),
  ];
}

export function arrangeCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  const horizontal = ctx.canTransformSelection
    ? enabled(
        'arrange.flip-horizontal',
        'arrange',
        'Flip Horizontal',
        'Flip selection horizontally',
        ctx.flipHorizontal,
        'H',
      )
    : disabled(
        'arrange.flip-horizontal',
        'arrange',
        'Flip Horizontal',
        'Select an object to flip.',
        ctx.flipHorizontal,
        'H',
      );
  const vertical = ctx.canTransformSelection
    ? enabled(
        'arrange.flip-vertical',
        'arrange',
        'Flip Vertical',
        'Flip selection vertically',
        ctx.flipVertical,
        'V',
      )
    : disabled(
        'arrange.flip-vertical',
        'arrange',
        'Flip Vertical',
        'Select an object to flip.',
        ctx.flipVertical,
        'V',
      );
  return [horizontal, vertical];
}

export function laserCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  const connect =
    ctx.serialSupported && !ctx.connected
      ? enabled(
          'laser.connect',
          'laser',
          'Connect',
          'Connect to laser controller',
          ctx.connectLaser,
        )
      : disabled('laser.connect', 'laser', 'Connect', connectDisabledReason(ctx), ctx.connectLaser);
  const disconnect =
    ctx.connected && !ctx.machineBusy
      ? enabled(
          'laser.disconnect',
          'laser',
          'Disconnect',
          'Disconnect from laser controller',
          ctx.disconnectLaser,
        )
      : disabled(
          'laser.disconnect',
          'laser',
          'Disconnect',
          disconnectDisabledReason(ctx),
          ctx.disconnectLaser,
        );
  const home =
    ctx.connected && ctx.homingEnabled && !ctx.machineBusy
      ? enabled('laser.home', 'laser', 'Home', 'Send homing command', ctx.homeLaser)
      : disabled('laser.home', 'laser', 'Home', homeDisabledReason(ctx), ctx.homeLaser);
  return [connect, disconnect, home];
}

export function windowCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  // Preview is gated on previewable content (M27/F-A8) — but ALWAYS
  // exit-able, so emptying the scene mid-preview can't trap the mode on.
  const previewCommand =
    ctx.hasPreviewableContent || ctx.previewActive
      ? {
          ...enabled(
            'window.toggle-preview',
            'window',
            'Preview',
            ctx.previewActive ? 'Exit preview (P)' : 'Preview the exact toolpath the machine runs',
            ctx.togglePreview,
            'P',
          ),
          active: ctx.previewActive,
        }
      : disabled(
          'window.toggle-preview',
          'window',
          'Preview',
          'Enable Output on at least one layer with objects to preview',
          ctx.togglePreview,
          'P',
        );
  return [
    previewCommand,
    enabled(
      'window.fit-view',
      'window',
      'Fit View',
      'Fit the bed to the window',
      ctx.resetView,
      'F',
    ),
  ];
}

export function helpCommand(ctx: AppCommandContext): AppCommand {
  return enabled('help.about', 'help', 'About LaserForge', 'Show build information', ctx.showAbout);
}

function connectDisabledReason(ctx: AppCommandContext): string {
  if (!ctx.serialSupported) return 'WebSerial is not supported in this browser.';
  if (ctx.connected) return 'Laser is already connected.';
  return 'Laser is not ready to connect.';
}

function disconnectDisabledReason(ctx: AppCommandContext): string {
  if (!ctx.connected) return 'Laser is not connected.';
  if (ctx.machineBusy) return 'Machine is busy. Use the laser panel controls first.';
  return 'Disconnect is unavailable.';
}

function homeDisabledReason(ctx: AppCommandContext): string {
  if (!ctx.connected) return 'Connect to the laser first.';
  if (!ctx.homingEnabled) return 'Homing is disabled in Device settings.';
  if (ctx.machineBusy) return 'Machine is busy. Wait or stop the active operation first.';
  return 'Home is unavailable.';
}
