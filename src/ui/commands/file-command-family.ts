import { enabled, type AppCommand, type AppCommandContext } from './command-types';
import { gcodeInspectorCommands } from './gcode-command-family';
import { templateCommands } from './template-command-family';
import { recentProjectsCommand } from './recent-projects-command';

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
    enabled('file.open', 'file', 'Open...', 'Open project', ctx.openProject, 'Ctrl+O'),
    recentProjectsCommand(ctx),
    enabled('file.save', 'file', 'Save', 'Save project', ctx.saveProject, 'Ctrl+S'),
    enabled(
      'file.save-as',
      'file',
      'Save As...',
      'Save project as',
      ctx.saveProjectAs,
      'Ctrl+Shift+S',
    ),
    ...templateCommands(ctx),
    enabled(
      'file.import',
      'file',
      'Import...',
      'Import SVG, DXF, PDF/AI, HPGL/PLT, images or STL artwork',
      ctx.importArtwork,
      'Ctrl+I',
    ),
    enabled('file.import-svg', 'file', 'Import SVG...', 'Import SVG file', ctx.importSvg),
    enabled('file.import-dxf', 'file', 'Import DXF...', 'Import DXF drawing', ctx.importDxf),
    enabled(
      'file.import-image',
      'file',
      'Import Image...',
      'Import PNG, JPG, BMP, GIF or TIFF image',
      ctx.importImage,
    ),
    enabled(
      'file.import-height-map',
      'file',
      'Import Height Map...',
      'Import an exact grayscale PNG as CNC relief depth',
      ctx.importHeightMap,
    ),
    enabled(
      'file.save-gcode',
      'file',
      'Save G-code...',
      'Export G-code',
      ctx.saveGcode,
      'Ctrl+Shift+E',
    ),
    enabled(
      'file.export-svg',
      'file',
      ctx.hasSelection ? 'Export selected artwork as SVG...' : 'Export artwork as SVG...',
      'Export selected artwork, or all artwork when nothing is selected, as SVG',
      ctx.exportSvg,
    ),
    enabled(
      'file.export-dxf',
      'file',
      ctx.hasSelection ? 'Export selected artwork as DXF...' : 'Export artwork as DXF...',
      'Export selected artwork, or all artwork when nothing is selected, as a millimetre DXF',
      ctx.exportDxf,
    ),
    ...gcodeInspectorCommands(ctx),
  ];
}
