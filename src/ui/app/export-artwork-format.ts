// File > Export artwork as PDF... / EPS... / GeoJSON... (ADR-455).
// Artwork interchange only: geometry and colour, no machine settings. The
// flow matches Export artwork as DXF: capture the artwork and clock before
// the picker, refuse image-only selections before asking for a file name,
// outline variable text, then write.

import { DEFAULT_PROJECT_VARIABLE_DATA, type Project } from '../../core/scene';
import { err, ok, type Result } from '../../core/result';
import { materializeVariableText } from '../../io/gcode/prepare-output-snapshot';
import { writeEpsDocument } from '../../io/vector-formats/eps-writer';
import { writeGeoJsonDocument } from '../../io/vector-formats/geojson-writer';
import { writePdfDocument } from '../../io/vector-formats/pdf-writer';
import {
  hasVectorArtwork,
  sceneVectorArtwork,
  type VectorPaintItem,
} from '../../io/vector-formats/vector-artwork';
import type { PlatformAdapter } from '../../platform/types';
import { renderVariableText } from '../text/render-variable-text';
import type { ToastVariant } from '../state/toast-store';
import { exportProjectSelection } from './export-artwork-svg';

export type ArtworkVectorFormat = 'pdf' | 'eps' | 'geojson';

type FormatSpec = {
  readonly label: string;
  readonly extension: string;
  readonly mime: string;
  readonly write: (items: ReadonlyArray<VectorPaintItem>, title: string) => string;
  readonly note: string;
};

const FORMATS: Readonly<Record<ArtworkVectorFormat, FormatSpec>> = {
  pdf: {
    label: 'PDF',
    extension: '.pdf',
    mime: 'application/pdf',
    write: (items, title) => writePdfDocument(items, { title }).text,
    note: 'The page is the artwork extent; curves stay curves.',
  },
  eps: {
    label: 'EPS',
    extension: '.eps',
    mime: 'application/postscript',
    write: (items, title) => writeEpsDocument(items, { title }).text,
    note: 'The bounding box is the artwork extent; curves stay curves.',
  },
  geojson: {
    label: 'GeoJSON',
    extension: '.geojson',
    mime: 'application/geo+json',
    write: (items) => writeGeoJsonDocument(items).text,
    note: 'Curves are flattened within 0.01 mm; coordinates are millimetres with y up.',
  },
};

export type ExportArtworkFormatContext = {
  readonly format: ArtworkVectorFormat;
  readonly platform: PlatformAdapter;
  readonly project: Project;
  readonly selectedIds: readonly string[];
  readonly savedName: string | null;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
  readonly clock?: () => Date;
  readonly renderer?: typeof renderVariableText;
};

export async function handleExportArtworkFormat(ctx: ExportArtworkFormatContext): Promise<void> {
  const spec = FORMATS[ctx.format];
  const ids = ctx.selectedIds.length > 0 ? [...ctx.selectedIds] : undefined;
  const project = exportProjectSelection(ctx.project, ids);
  const variables = project.variables ?? DEFAULT_PROJECT_VARIABLE_DATA;
  const evaluation = {
    now: (ctx.clock ?? (() => new Date()))(),
    recordIndex: variables.recordIndex,
    serialValue: variables.serialValue,
  };
  const nothing = nothingToExport(project, ids, spec.label);
  if (nothing !== null) {
    ctx.pushToast(nothing, 'warning');
    return;
  }
  const failed = (message: string): void =>
    ctx.pushToast('Could not export ' + spec.label + ': ' + message, 'error');
  try {
    const stem = fileStem(ctx.savedName, ids !== undefined);
    const target = await ctx.platform.pickFileForSave({
      suggestedName: stem + spec.extension,
      extensions: [spec.extension],
    });
    if (target === null) return;
    const file = await exportFile(ctx, spec, project, ids, evaluation, stem);
    if (file.kind === 'error') {
      failed(file.error);
      return;
    }
    await target.write(new Blob([file.value.text], { type: spec.mime }));
    const omitted = file.value.omittedObjectCount;
    ctx.pushToast(
      'Exported ' +
        file.value.objectCount +
        ' artwork item(s) to ' +
        target.displayName +
        '. Text is outlined. ' +
        spec.note +
        (omitted > 0 ? ' ' + omitted + ' image or relief item(s) were left out.' : ''),
      omitted > 0 ? 'warning' : 'success',
    );
  } catch (error) {
    failed(error instanceof Error ? error.message : String(error));
  }
}

async function exportFile(
  ctx: ExportArtworkFormatContext,
  spec: FormatSpec,
  project: Project,
  ids: readonly string[] | undefined,
  evaluation: Parameters<typeof materializeVariableText>[1],
  title: string,
): Promise<Result<{ text: string; objectCount: number; omittedObjectCount: number }, string>> {
  const resolved = await materializeVariableText(
    project,
    evaluation,
    ctx.renderer ?? renderVariableText,
  );
  if (!resolved.ok) return err(resolved.preflight.issues.map((issue) => issue.message).join(' '));
  const artwork = sceneVectorArtwork(resolved.project, ids);
  if (artwork.kind === 'error') return artwork;
  const text = writeText(spec, artwork.value.items, title);
  if (text.kind === 'error') return text;
  return ok({
    text: text.value,
    objectCount: artwork.value.objectCount,
    omittedObjectCount: artwork.value.omittedObjectCount,
  });
}

function writeText(
  spec: FormatSpec,
  items: ReadonlyArray<VectorPaintItem>,
  title: string,
): Result<string, string> {
  try {
    return ok(spec.write(items, title));
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

function nothingToExport(
  project: Project,
  ids: readonly string[] | undefined,
  label: string,
): string | null {
  if (project.scene.objects.length === 0) return 'There is no artwork to export.';
  if (!hasVectorArtwork(project, ids)) {
    return label + ' export holds vector artwork only. Select vector, text or traced artwork.';
  }
  return null;
}

function fileStem(savedName: string | null, selected: boolean): string {
  const source = (savedName ?? 'artwork').split(/[/\\]/).pop() ?? 'artwork';
  const stem =
    source
      .replace(/\.[^.]*$/, '')
      .replace(/[<>:"/\\|?*]/g, '-')
      .trim() || 'artwork';
  return stem + (selected ? '-selection' : '');
}
