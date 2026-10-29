import { DEFAULT_PROJECT_VARIABLE_DATA, type Project, type RasterImage } from '../../core/scene';
import {
  materializeVariableText,
  type TextGlyphAdvisory,
} from '../../io/gcode/prepare-output-snapshot';
import { exportSceneSvg } from '../../io/svg/export-scene-svg';
import type { PlatformAdapter } from '../../platform/types';
import { pickPreparedSaveTarget } from './pick-prepared-save-target';
import { embedSvgRasterImages } from './svg-artwork-images';
import { outputTextRenderer } from '../text/output-text-renderer';
import type { ToastVariant } from '../state/toast-store';

export type ExportArtworkSvgContext = {
  readonly platform: PlatformAdapter;
  readonly project: Project;
  readonly selectedIds: readonly string[];
  readonly savedName: string | null;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
  readonly clock?: () => Date;
  readonly renderer?: typeof outputTextRenderer;
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
    // The picker empties an existing file as it returns (ADR-656): every
    // fallible step runs first.
    const resolved = await materializeVariableText(
      project,
      evaluation,
      ctx.renderer ?? outputTextRenderer,
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
    const target = await pickPreparedSaveTarget(
      ctx.platform,
      { suggestedName: svgFilename(ctx.savedName, ids !== undefined), extensions: ['.svg'] },
      { title: 'Export SVG', message: 'The SVG is ready.' },
    );
    if (target === null) return;
    await target.write(new Blob([result.value.svg], { type: 'image/svg+xml' }));
    const glyphs = glyphWarnings(resolved.advisories);
    ctx.pushToast(
      [
        'Exported ' +
          result.value.objectCount +
          ' artwork item(s) to ' +
          target.displayName +
          '. Text is outlined.',
        ...glyphs,
      ].join(' '),
      glyphs.length === 0 ? 'success' : 'warning',
    );
  } catch (error) {
    ctx.pushToast(
      'Could not export SVG: ' + (error instanceof Error ? error.message : String(error)),
      'error',
    );
  }
}

/**
 * Outlined text keeps only the glyphs its font has, so an export names the characters each text
 * lost, as Start and Save do (ADR-591 Amendment 2).
 */
export function glyphWarnings(advisories: ReadonlyArray<TextGlyphAdvisory>): ReadonlyArray<string> {
  return advisories.map((advisory) => advisory.issue.message);
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
