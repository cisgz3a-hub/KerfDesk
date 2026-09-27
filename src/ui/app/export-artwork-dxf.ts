import { DEFAULT_PROJECT_VARIABLE_DATA, type Project } from '../../core/scene';
import { materializeVariableText } from '../../io/gcode/prepare-output-snapshot';
import { err } from '../../core/result';
import {
  exportSceneDxf,
  hasDxfVectorArtwork,
  type DxfArtworkExport,
} from '../../io/dxf/export-dxf';
import type { PlatformAdapter } from '../../platform/types';
import { renderVariableText } from '../text/render-variable-text';
import type { ToastVariant } from '../state/toast-store';
import { exportProjectSelection } from './export-artwork-svg';

export type ExportArtworkDxfContext = {
  readonly platform: PlatformAdapter;
  readonly project: Project;
  readonly selectedIds: readonly string[];
  readonly savedName: string | null;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
  readonly clock?: () => Date;
  readonly renderer?: typeof renderVariableText;
};

export async function handleExportArtworkDxf(ctx: ExportArtworkDxfContext): Promise<void> {
  // Capture the artwork and clock before the picker, as the SVG export does.
  const ids = ctx.selectedIds.length > 0 ? [...ctx.selectedIds] : undefined;
  const project = exportProjectSelection(ctx.project, ids);
  const variables = project.variables ?? DEFAULT_PROJECT_VARIABLE_DATA;
  const evaluation = {
    now: (ctx.clock ?? (() => new Date()))(),
    recordIndex: variables.recordIndex,
    serialValue: variables.serialValue,
  };
  const nothing = nothingToExport(project, ids);
  if (nothing !== null) {
    ctx.pushToast(nothing, 'warning');
    return;
  }
  try {
    const target = await ctx.platform.pickFileForSave({
      suggestedName: dxfFilename(ctx.savedName, ids !== undefined),
      extensions: ['.dxf'],
    });
    if (target === null) return;
    const resolved = await materializeVariableText(
      project,
      evaluation,
      ctx.renderer ?? renderVariableText,
    );
    const result = resolved.ok
      ? exportSceneDxf(resolved.project, ids)
      : err(resolved.preflight.issues.map((issue) => issue.message).join(' '));
    if (result.kind === 'error') {
      ctx.pushToast('Could not export DXF: ' + result.error, 'error');
      return;
    }
    await target.write(new Blob([result.value.dxf], { type: 'application/dxf' }));
    const omitted = result.value.omittedObjectCount;
    ctx.pushToast(
      exportedMessage(result.value, target.displayName),
      omitted > 0 ? 'warning' : 'success',
    );
  } catch (error) {
    ctx.pushToast(
      'Could not export DXF: ' + (error instanceof Error ? error.message : String(error)),
      'error',
    );
  }
}

/** Why the picker must not open, or null when there is vector artwork to write. */
function nothingToExport(project: Project, ids: readonly string[] | undefined): string | null {
  if (project.scene.objects.length === 0) return 'There is no artwork to export.';
  // Images and reliefs have no DXF form: refuse before asking for a file name.
  if (!hasDxfVectorArtwork(project, ids)) {
    return 'DXF holds vector artwork only. Select vector, text or traced artwork.';
  }
  return null;
}

function exportedMessage(result: DxfArtworkExport, displayName: string): string {
  const omitted = result.omittedObjectCount;
  return (
    'Exported ' +
    result.objectCount +
    ' artwork item(s) to ' +
    displayName +
    ' in millimetres. Text is outlined.' +
    (omitted > 0 ? ' ' + omitted + ' image or relief item(s) were left out.' : '')
  );
}

function dxfFilename(savedName: string | null, selected: boolean): string {
  const source = (savedName ?? 'artwork').split(/[/\\]/).pop() ?? 'artwork';
  const stem =
    source
      .replace(/\.[^.]*$/, '')
      .replace(/[<>:"/\\|?*]/g, '-')
      .trim() || 'artwork';
  return stem + (selected ? '-selection' : '') + '.dxf';
}
