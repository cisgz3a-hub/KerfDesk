import { DEFAULT_PROJECT_VARIABLE_DATA, type Project, type RasterImage } from '../../core/scene';
import { materializeVariableText } from '../../io/gcode/prepare-output-snapshot';
import { exportSceneSvg } from '../../io/svg/export-scene-svg';
import type { PlatformAdapter } from '../../platform/types';
import { embedSvgRasterImages } from './svg-artwork-images';
import { renderVariableText } from '../text/render-variable-text';
import type { ToastVariant } from '../state/toast-store';

export type ExportArtworkSvgContext = {
  readonly platform: PlatformAdapter;
  readonly project: Project;
  readonly selectedIds: readonly string[];
  readonly savedName: string | null;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
  readonly clock?: () => Date;
  readonly renderer?: typeof renderVariableText;
  readonly readImageSource?: (image: RasterImage) => Promise<string>;
  /** Group each filled shape with its holes (ADR-451). Default off. */
  readonly groupContours?: boolean;
};

export async function handleExportArtworkSvg(ctx: ExportArtworkSvgContext): Promise<void> {
  // Capture both the artwork and clock before the picker. No later edit or document
  // replacement may change the bytes associated with this user's export click.
  const ids = ctx.selectedIds.length > 0 ? [...ctx.selectedIds] : undefined;
  const project = exportProjectSelection(ctx.project, ids);
  const variables = project.variables ?? DEFAULT_PROJECT_VARIABLE_DATA;
  const evaluation = {
    now: (ctx.clock ?? (() => new Date()))(),
    recordIndex: variables.recordIndex,
    serialValue: variables.serialValue,
  };
  if (project.scene.objects.length === 0) {
    ctx.pushToast('There is no artwork to export.', 'warning');
    return;
  }
  try {
    const target = await ctx.platform.pickFileForSave({
      suggestedName: svgFilename(ctx.savedName, ids !== undefined),
      extensions: ['.svg'],
    });
    if (target === null) return;
    const resolved = await materializeVariableText(
      project,
      evaluation,
      ctx.renderer ?? renderVariableText,
    );
    if (!resolved.ok) {
      ctx.pushToast(
        'Could not export SVG: ' +
          resolved.preflight.issues.map((issue) => issue.message).join(' '),
        'error',
      );
      return;
    }
    const objects = await embedSvgRasterImages(resolved.project.scene.objects, ctx.readImageSource);
    const result = exportSceneSvg(
      { ...resolved.project, scene: { ...resolved.project.scene, objects } },
      ids,
      ctx.groupContours === true ? { groupContours: true } : {},
    );
    if (result.kind === 'error') {
      ctx.pushToast('Could not export SVG: ' + result.error, 'error');
      return;
    }
    await target.write(new Blob([result.value.svg], { type: 'image/svg+xml' }));
    ctx.pushToast(
      'Exported ' +
        result.value.objectCount +
        ' artwork item(s) to ' +
        target.displayName +
        '. Text is outlined.',
      'success',
    );
  } catch (error) {
    ctx.pushToast(
      'Could not export SVG: ' + (error instanceof Error ? error.message : String(error)),
      'error',
    );
  }
}

export function exportProjectSelection(
  project: Project,
  ids: readonly string[] | undefined,
): Project {
  if (ids === undefined) return project;
  const selected = new Set(ids);
  const objects = new Map(project.scene.objects.map((object) => [object.id, object]));
  // Set iteration includes dependencies added during traversal, regardless of scene order.
  for (const id of selected) {
    const object = objects.get(id);
    if (object?.kind === 'raster-image' && object.imageMaskId !== undefined)
      selected.add(object.imageMaskId);
    if (object?.kind === 'text' && object.pathText !== undefined)
      selected.add(object.pathText.guideObjectId);
  }
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: project.scene.objects.filter((object) => selected.has(object.id)),
    },
  };
}

function svgFilename(savedName: string | null, selected: boolean): string {
  const source = (savedName ?? 'artwork').split(/[/\\]/).pop() ?? 'artwork';
  const stem =
    source
      .replace(/\.[^.]*$/, '')
      .replace(/[<>:"/\\|?*]/g, '-')
      .trim() || 'artwork';
  return stem + (selected ? '-selection' : '') + '.svg';
}
