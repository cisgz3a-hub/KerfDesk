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
import {
  TEXT_SIZE_MAX_MM,
  TEXT_SIZE_MIN_MM,
  textSizeInRange,
} from '../../../core/text/text-limits';
import { renderStyledText } from '../../text/render-styled-text';
import { boxCentre } from '../../../core/geometry/box-math';

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
  if (!content.trim() || !textSizeInRange(input.sizeMm)) {
    throw new Error(
      `Enter text and a size between ${TEXT_SIZE_MIN_MM} and ${TEXT_SIZE_MAX_MM} mm.`,
    );
  }
  const properties = {
    ...textStyle(existing),
    content,
    fontKey: input.fontKey,
    sizeMm: input.sizeMm,
  };
  // ADR-321 Amendment 1: an edit keeps the text's style, text box and weld.
  const rendered = await renderStyledText(
    { ...existing, ...properties },
    content,
    project.embeddedFonts,
  );
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
  // ADR-321 Amendment 1: new jig text welds its overlaps, as new desktop text does.
  const weldOverlaps = existing === undefined ? true : existing.weldOverlaps;
  return {
    ...(weldOverlaps === undefined ? {} : { weldOverlaps }),
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
    ? applyTransform(boxCentre(anchor.bounds), anchor.transform)
    : { x: project.device.bedWidth / 2, y: project.device.bedHeight / 2 };
  const nextCenter = applyTransform(boxCentre(bounds), transform);
  return {
    ...transform,
    x: transform.x + target.x - nextCenter.x,
    y: transform.y + target.y - nextCenter.y,
  };
}
