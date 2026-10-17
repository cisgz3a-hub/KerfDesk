import {
  applyTransform,
  findRegistrationBoxes,
  IDENTITY_TRANSFORM,
  type Bounds,
  type Project,
  type TextObject,
  type Transform,
} from '../../../core/scene';
import {
  DEFAULT_TEXT_ALIGNMENT,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_LETTER_SPACING,
  DEFAULT_TEXT_LINE_HEIGHT,
} from '../../../core/text';
import { renderTextGeometry } from '../../text/render-text-geometry';

export function isAdvancedJigText(object: TextObject): boolean {
  const binding = JSON.stringify(object.paths[0]?.operationIds ?? null);
  return (
    object.pathText !== undefined ||
    object.variableTemplate !== undefined ||
    (object.bendDeg ?? 0) !== 0 ||
    (object.cncTabAnchors?.length ?? 0) > 0 ||
    object.paths.some((path) => JSON.stringify(path.operationIds ?? null) !== binding)
  );
}

export async function renderJigText(input: {
  readonly project: Project;
  readonly existing: TextObject | undefined;
  readonly content: string;
  readonly fontKey: string;
  readonly sizeMm: number;
}): Promise<TextObject> {
  const { existing, project } = input;
  if (existing && isAdvancedJigText(existing))
    throw new Error('Use the main text editor for advanced text.');
  const content = input.content.normalize('NFC');
  if (!content.trim() || !Number.isFinite(input.sizeMm) || input.sizeMm < 1 || input.sizeMm > 300) {
    throw new Error('Enter text and a size between 1 and 300 mm.');
  }
  const properties = {
    ...textStyle(existing),
    content,
    fontKey: input.fontKey,
    sizeMm: input.sizeMm,
  };
  const rendered = await renderTextGeometry({
    ...properties,
    embeddedFonts: project.embeddedFonts,
  });
  const pathOperations = existing?.paths[0]?.operationIds;
  return {
    ...existing,
    kind: 'text',
    id: existing?.id ?? crypto.randomUUID(),
    ...properties,
    bounds: rendered.bounds,
    paths:
      pathOperations === undefined
        ? rendered.paths
        : rendered.paths.map((path) => ({ ...path, operationIds: pathOperations })),
    transform: textPlacement(project, existing, rendered.bounds),
  };
}

function textStyle(existing: TextObject | undefined) {
  return {
    alignment: existing?.alignment ?? DEFAULT_TEXT_ALIGNMENT,
    lineHeight: existing?.lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT,
    letterSpacing: existing?.letterSpacing ?? DEFAULT_TEXT_LETTER_SPACING,
    color: existing?.color ?? DEFAULT_TEXT_COLOR,
  };
}

function textPlacement(
  project: Project,
  existing: TextObject | undefined,
  bounds: Bounds,
): Transform {
  const transform = existing?.transform ?? IDENTITY_TRANSFORM;
  const anchor = existing ?? findRegistrationBoxes(project.scene)[0];
  const target = anchor
    ? applyTransform(center(anchor.bounds), anchor.transform)
    : { x: project.device.bedWidth / 2, y: project.device.bedHeight / 2 };
  const nextCenter = applyTransform(center(bounds), transform);
  return {
    ...transform,
    x: transform.x + target.x - nextCenter.x,
    y: transform.y + target.y - nextCenter.y,
  };
}

function center(bounds: Bounds): { readonly x: number; readonly y: number } {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}
