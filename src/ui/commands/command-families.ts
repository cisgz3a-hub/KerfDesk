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
    enabled(
      'file.save-gcode',
      'file',
      'Save G-code...',
      'Export G-code',
      ctx.saveGcode,
      'Ctrl+Shift+E',
    ),
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
    ...calibrationToolCommands(ctx),
    enabled(
      'tools.optimization-settings',
      'tools',
      'Optimization Settings...',
      'Adjust output path optimization',
      ctx.optimizationSettings,
    ),
    rasterToolCommand(ctx, 'tools.adjust-image', 'Adjust Image...', 'Adjust selected image'),
    rasterToolCommand(ctx, 'tools.trace-image', 'Trace Image...', 'Trace selected image'),
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

function calibrationToolCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    enabled(
      'tools.material-test',
      'tools',
      'Material Test...',
      'Create a material test grid',
      guardedCalibrationAction(ctx, 'create a material test', ctx.materialTest),
    ),
    enabled(
      'tools.interval-test',
      'tools',
      'Interval Test...',
      'Create an interval test grid',
      guardedCalibrationAction(ctx, 'create an interval test', ctx.intervalTest),
    ),
    enabled(
      'tools.scan-offset-test',
      'tools',
      'Scan Offset Test...',
      'Create a bidirectional scan-offset calibration pattern',
      guardedCalibrationAction(ctx, 'create a scan offset test', ctx.scanOffsetTest),
    ),
    focusTestCommand(ctx),
  ];
}

function focusTestCommand(ctx: AppCommandContext): AppCommand {
  const invoke = guardedCalibrationAction(ctx, 'create a focus test', ctx.focusTest);
  return ctx.focusTestAvailable
    ? enabled(
        'tools.focus-test',
        'tools',
        'Focus Test...',
        'Create a Z-axis focus test pattern',
        invoke,
      )
    : disabled(
        'tools.focus-test',
        'tools',
        'Focus Test...',
        'Active machine profile needs verified controllable Z-axis support before Focus Test can run.',
        invoke,
      );
}

function guardedCalibrationAction(
  ctx: AppCommandContext,
  action: string,
  run: () => void,
): () => void {
  return () => {
    void ctx.confirmDiscard(action).then((ok) => {
      if (ok) run();
    });
  };
}

function rasterToolCommand(
  ctx: AppCommandContext,
  id: 'tools.adjust-image' | 'tools.trace-image',
  label: string,
  title: string,
): AppCommand {
  const invoke = id === 'tools.adjust-image' ? ctx.adjustImage : ctx.traceImage;
  return ctx.hasRasterSelection
    ? enabled(id, 'tools', label, title, invoke)
    : disabled(id, 'tools', label, 'Select an image first.', invoke);
}

export function arrangeCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  const align = ALIGN_COMMANDS.map((spec) =>
    ctx.canAlignSelection
      ? enabled(spec.id, 'arrange', spec.label, spec.title, () => ctx.alignSelection(spec.kind))
      : disabled(spec.id, 'arrange', spec.label, 'Select at least two objects to align.', () =>
          ctx.alignSelection(spec.kind),
        ),
  );
  const distribute = DISTRIBUTE_COMMANDS.map((spec) =>
    ctx.canDistributeSelection
      ? enabled(spec.id, 'arrange', spec.label, spec.title, () =>
          ctx.distributeSelection(spec.kind),
        )
      : disabled(
          spec.id,
          'arrange',
          spec.label,
          'Select at least three objects to distribute.',
          () => ctx.distributeSelection(spec.kind),
        ),
  );
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
  return [...align, ...distribute, horizontal, vertical];
}

const ALIGN_COMMANDS = [
  {
    id: 'arrange.align-left',
    kind: 'left',
    label: 'Align Left',
    title: 'Align selected objects to the reference left edge',
  },
  {
    id: 'arrange.align-center-x',
    kind: 'center-x',
    label: 'Align Center X',
    title: 'Align selected objects to the reference vertical center',
  },
  {
    id: 'arrange.align-right',
    kind: 'right',
    label: 'Align Right',
    title: 'Align selected objects to the reference right edge',
  },
  {
    id: 'arrange.align-top',
    kind: 'top',
    label: 'Align Top',
    title: 'Align selected objects to the reference top edge',
  },
  {
    id: 'arrange.align-center-y',
    kind: 'center-y',
    label: 'Align Center Y',
    title: 'Align selected objects to the reference horizontal center',
  },
  {
    id: 'arrange.align-bottom',
    kind: 'bottom',
    label: 'Align Bottom',
    title: 'Align selected objects to the reference bottom edge',
  },
  {
    id: 'arrange.align-centers',
    kind: 'centers',
    label: 'Align Centers',
    title: 'Center selected objects over the reference object',
  },
] as const;

const DISTRIBUTE_COMMANDS = [
  {
    id: 'arrange.distribute-horizontal-centers',
    kind: 'horizontal-centers',
    label: 'Distribute H Centers',
    title: 'Evenly space selected object centers horizontally',
  },
  {
    id: 'arrange.distribute-horizontal-spacing',
    kind: 'horizontal-spacing',
    label: 'Distribute H Spacing',
    title: 'Evenly space selected object edges horizontally',
  },
  {
    id: 'arrange.distribute-vertical-centers',
    kind: 'vertical-centers',
    label: 'Distribute V Centers',
    title: 'Evenly space selected object centers vertically',
  },
  {
    id: 'arrange.distribute-vertical-spacing',
    kind: 'vertical-spacing',
    label: 'Distribute V Spacing',
    title: 'Evenly space selected object edges vertically',
  },
] as const;

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
