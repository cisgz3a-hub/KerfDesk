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
    ...artworkExportCommands(ctx),
    ...gcodeInspectorCommands(ctx),
    // Desktop app only (ADR-554): closes KerfDesk through the Save question
    // and the job Abort handoff, as the window's X does.
    ...(ctx.exitApp === undefined
      ? []
      : [enabled('file.exit', 'file', 'Exit', 'Close KerfDesk', ctx.exitApp)]),
  ];
}

/** Export artwork as SVG / DXF / PDF / EPS / GeoJSON (ADR-431, ADR-468). */
function artworkExportCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
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
    enabled(
      'file.export-pdf',
      'file',
      ctx.hasSelection ? 'Export selected artwork as PDF...' : 'Export artwork as PDF...',
      'Export selected artwork, or all artwork when nothing is selected, as a vector PDF',
      ctx.exportPdf,
    ),
    enabled(
      'file.export-eps',
      'file',
      ctx.hasSelection ? 'Export selected artwork as EPS...' : 'Export artwork as EPS...',
      'Export selected artwork, or all artwork when nothing is selected, as Encapsulated PostScript',
      ctx.exportEps,
    ),
    enabled(
      'file.export-geojson',
      'file',
      ctx.hasSelection ? 'Export selected artwork as GeoJSON...' : 'Export artwork as GeoJSON...',
      'Export selected artwork, or all artwork when nothing is selected, as GeoJSON in millimetres',
      ctx.exportGeoJson,
    ),
  ];
}
