// command-families — the per-menu-family command builders consumed by
// buildAppCommands. Pure functions of AppCommandContext.

import { CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM } from '../common/fill-diagnostics';
import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';
import { registrationJigCommand } from './registration-command-family';

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

export function toolsCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    {
      ...enabled(
        'tools.measure',
        'tools',
        'Measure',
        'Measure distance and angle on the workspace',
        ctx.measureTool,
        'Alt+M',
      ),
      active: ctx.measureActive,
    },
    enabled('tools.add-text', 'tools', 'Text...', 'Add text to the scene', ctx.addText),
    registrationJigCommand(ctx),
    ...calibrationToolCommands(ctx),
    enabled(
      'tools.optimization-settings',
      'tools',
      'Optimization Settings...',
      'Adjust output path optimization',
      ctx.optimizationSettings,
    ),
    rasterToolCommand(ctx, 'tools.adjust-image', 'Adjust Image...', 'Adjust selected image'),
    imageMaskApplyCommand(ctx),
    imageMaskCropCommand(ctx),
    imageMaskRemoveCommand(ctx),
    rasterToolCommand(
      ctx,
      'tools.save-processed-bitmap',
      'Save Processed Bitmap...',
      'Save selected image after layer processing',
    ),
    rasterToolCommand(ctx, 'tools.trace-image', 'Trace Image...', 'Trace selected image'),
    enabled(
      'tools.multi-file-trace',
      'tools',
      'Multi-File Trace...',
      'Trace multiple image files to SVG exports',
      ctx.multiFileTrace,
    ),
    ctx.hasFillableSelection
      ? enabled(
          'tools.fill-selection',
          'tools',
          'Fill Selection',
          'Move selected vector artwork to a dedicated Fill layer',
          ctx.fillSelectionSeparately,
        )
      : disabled(
          'tools.fill-selection',
          'tools',
          'Fill Selection',
          'Select vector artwork first.',
          ctx.fillSelectionSeparately,
        ),
    closeOpenFillContoursCommand(ctx),
    reviewCloseOpenFillContoursCommand(ctx),
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

function closeOpenFillContoursCommand(ctx: AppCommandContext): AppCommand {
  const label = 'Close Open Fill Contours';
  return ctx.canCloseOpenFillContours
    ? enabled(
        'tools.close-open-fill-contours',
        'tools',
        label,
        'Mark selected near-closed Fill contours as closed',
        ctx.closeSelectedOpenFillContours,
      )
    : disabled(
        'tools.close-open-fill-contours',
        'tools',
        label,
        `Select open Fill contours with endpoints within ${CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM} mm.`,
        ctx.closeSelectedOpenFillContours,
      );
}

function reviewCloseOpenFillContoursCommand(ctx: AppCommandContext): AppCommand {
  const label = 'Close Fill Contours With Tolerance...';
  return ctx.canReviewCloseOpenFillContours
    ? enabled(
        'tools.close-fill-contours-with-tolerance',
        'tools',
        label,
        'Review selected open Fill contours before closing a larger endpoint gap',
        ctx.reviewCloseOpenFillContours,
      )
    : disabled(
        'tools.close-fill-contours-with-tolerance',
        'tools',
        label,
        'Select open Fill contours on an output Fill layer.',
        ctx.reviewCloseOpenFillContours,
      );
}

function imageMaskApplyCommand(ctx: AppCommandContext): AppCommand {
  return ctx.canApplyImageMask
    ? enabled(
        'tools.apply-image-mask',
        'tools',
        'Apply Mask to Image',
        'Apply selected closed vector as an image mask',
        ctx.applyImageMask,
      )
    : disabled(
        'tools.apply-image-mask',
        'tools',
        'Apply Mask to Image',
        'Select one image and one closed vector mask.',
        ctx.applyImageMask,
      );
}

function imageMaskRemoveCommand(ctx: AppCommandContext): AppCommand {
  return ctx.hasMaskedRasterSelection
    ? enabled(
        'tools.remove-image-mask',
        'tools',
        'Remove Image Mask',
        'Remove the selected image mask',
        ctx.removeImageMask,
      )
    : disabled(
        'tools.remove-image-mask',
        'tools',
        'Remove Image Mask',
        'Select an image that already has a mask.',
        ctx.removeImageMask,
      );
}

function imageMaskCropCommand(ctx: AppCommandContext): AppCommand {
  return ctx.hasMaskedRasterSelection
    ? enabled(
        'tools.crop-image',
        'tools',
        'Crop Image',
        'Bake the selected image mask into pixels and crop its bounds',
        ctx.cropImage,
      )
    : disabled(
        'tools.crop-image',
        'tools',
        'Crop Image',
        'Select an image that already has a mask.',
        ctx.cropImage,
      );
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
  id: 'tools.adjust-image' | 'tools.save-processed-bitmap' | 'tools.trace-image',
  label: string,
  title: string,
): AppCommand {
  const invoke = rasterToolInvoke(ctx, id);
  return ctx.hasRasterSelection
    ? enabled(id, 'tools', label, title, invoke)
    : disabled(id, 'tools', label, 'Select an image first.', invoke);
}

function rasterToolInvoke(
  ctx: AppCommandContext,
  id: 'tools.adjust-image' | 'tools.save-processed-bitmap' | 'tools.trace-image',
): () => void {
  switch (id) {
    case 'tools.adjust-image':
      return ctx.adjustImage;
    case 'tools.save-processed-bitmap':
      return ctx.saveProcessedBitmap;
    case 'tools.trace-image':
      return ctx.traceImage;
  }
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
    enabled(
      'window.project-notes',
      'window',
      'Project Notes...',
      'Edit project notes',
      ctx.projectNotes,
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
