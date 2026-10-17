import {
  applyTransform,
  findRegistrationBoxes,
  transformedBounds,
  type Scene,
  type SceneObject,
} from '../../../core/scene';

// Fit to one physical blank, never the entire bed or the combined grid.
// Keep a small border and the artwork's proportions, including on round jigs.
export function fitJigArtwork(
  object: SceneObject,
  scene: Scene,
  selectedIds: ReadonlySet<string>,
): SceneObject {
  const outlines = findRegistrationBoxes(scene);
  const jig = outlines.find((outline) => selectedIds.has(outline.id)) ?? outlines[0];
  if (jig === undefined) return object;
  const width = (jig.bounds.maxX - jig.bounds.minX) * Math.abs(jig.transform.scaleX);
  const height = (jig.bounds.maxY - jig.bounds.minY) * Math.abs(jig.transform.scaleY);
  const footprint = transformedBounds(object.bounds, {
    ...object.transform,
    x: 0,
    y: 0,
    rotationDeg: object.transform.rotationDeg - jig.transform.rotationDeg,
  });
  const relativeWidth = (footprint.maxX - footprint.minX) / width;
  const relativeHeight = (footprint.maxY - footprint.minY) / height;
  const extent =
    jig.spec.kind === 'ellipse'
      ? Math.hypot(relativeWidth, relativeHeight)
      : Math.max(relativeWidth, relativeHeight);
  if (!Number.isFinite(extent) || extent <= 0) return object;
  const scale = 0.9 / extent;
  const transform = {
    ...object.transform,
    x: 0,
    y: 0,
    scaleX: object.transform.scaleX * scale,
    scaleY: object.transform.scaleY * scale,
  };
  const artworkCenter = applyTransform(
    {
      x: (object.bounds.minX + object.bounds.maxX) / 2,
      y: (object.bounds.minY + object.bounds.maxY) / 2,
    },
    transform,
  );
  const jigCenter = applyTransform(
    {
      x: (jig.bounds.minX + jig.bounds.maxX) / 2,
      y: (jig.bounds.minY + jig.bounds.maxY) / 2,
    },
    jig.transform,
  );
  return {
    ...object,
    transform: { ...transform, x: jigCenter.x - artworkCenter.x, y: jigCenter.y - artworkCenter.y },
  };
}
