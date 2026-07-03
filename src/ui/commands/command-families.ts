import { CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM } from '../common/fill-diagnostics';
import { APP_DISPLAY_NAME } from '../../core/app-branding';
import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';
import { registrationJigCommand } from './registration-command-family';
import { adjustImageCommand, processedRasterToolCommands } from './command-raster-family';
import { vectorBooleanCommands } from './vector-boolean-commands';

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
    enabled('file.import-dxf', 'file', 'Import DXF...', 'Import DXF drawing', ctx.importDxf),
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
    // CNC-only (hidden in laser mode by the machine gate, ADR-101).
    enabled(
      'file.open-gcode',
      'file',
      'Open G-code (Preview)...',
      'Simulate a .nc program',
      ctx.openGcodePreview,
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
    adjustImageCommand(ctx),
    imageMaskApplyCommand(ctx),
    imageMaskCropCommand(ctx),
    imageMaskRemoveCommand(ctx),
    ...processedRasterToolCommands(ctx),
    enabled(
      'tools.multi-file-trace',
      'tools',
      'Multi-File Trace...',
      'Trace multiple image files to SVG exports',
      ctx.multiFileTrace,
    ),
    convertToPathCommand(ctx),
    weldCommand(ctx),
    ...vectorBooleanCommands(ctx),
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

function convertToPathCommand(ctx: AppCommandContext): AppCommand {
  return ctx.canConvertSelectionToPath
    ? enabled(
        'tools.convert-to-path',
        'tools',
        'Convert to Path',
        'Bake selected vector artwork into editable path geometry',
        ctx.convertSelectionToPath,
      )
    : disabled(
        'tools.convert-to-path',
        'tools',
        'Convert to Path',
        'Select unlocked vector artwork first.',
        ctx.convertSelectionToPath,
      );
}

function weldCommand(ctx: AppCommandContext): AppCommand {
  return ctx.canWeldSelection
    ? enabled(
        'tools.weld',
        'tools',
        'Weld',
        'Union selected closed vector contours into one path object',
        ctx.weldSelection,
      )
    : disabled(
        'tools.weld',
        'tools',
        'Weld',
        'Select unlocked closed vector contours first.',
        ctx.weldSelection,
      );
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
    enabled(
      'window.undo-history',
      'window',
      'Undo History...',
      'Review undo and redo history',
      ctx.undoHistory,
    ),
  ];
}

export function helpCommand(ctx: AppCommandContext): AppCommand {
  return enabled(
    'help.about',
    'help',
    `About ${APP_DISPLAY_NAME}`,
    'Show build information',
    ctx.showAbout,
  );
}
