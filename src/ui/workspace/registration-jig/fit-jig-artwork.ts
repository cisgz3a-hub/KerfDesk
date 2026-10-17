import {
  applyTransform,
  findRegistrationBoxes,
  isRegistrationBox,
  transformedBBox,
  transformedBounds,
  type Scene,
  type SceneObject,
  type ShapeObject,
} from '../../../core/scene';

// Fit to one physical blank, never the entire bed or the combined grid.
// Keep a small border and the artwork's proportions, including on round jigs.
// File N of a multi-file import goes into the Nth outline from the anchor, so a
// batch of names or logos fills the jig instead of stacking on one blank.
export function fitJigArtwork(
  object: SceneObject,
  scene: Scene,
  selectedIds: ReadonlySet<string>,
  batchIndex = 0,
): SceneObject {
  const outlines = findRegistrationBoxes(scene);
  if (outlines.length === 0) return object;
  const anchor = anchorOutlineIndex(scene, outlines, selectedIds);
  const jig = outlines[(anchor + batchIndex) % outlines.length];
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

// A selected outline, else the outline holding the selected artwork, else the first.
function anchorOutlineIndex(
  scene: Scene,
  outlines: ReadonlyArray<ShapeObject>,
  selectedIds: ReadonlySet<string>,
): number {
  const selectedOutline = outlines.findIndex((outline) => selectedIds.has(outline.id));
  if (selectedOutline >= 0) return selectedOutline;
  for (const object of scene.objects) {
    if (!selectedIds.has(object.id) || isRegistrationBox(object)) continue;
    const box = transformedBBox(object);
    const holding = jigOutlineAt(outlines, {
      x: (box.minX + box.maxX) / 2,
      y: (box.minY + box.maxY) / 2,
    });
    if (holding >= 0) return holding;
  }
  return 0;
}

/** Index of the outline whose bounds contain the point, or -1. */
export function jigOutlineAt(
  outlines: ReadonlyArray<ShapeObject>,
  point: { readonly x: number; readonly y: number },
): number {
  return outlines.findIndex((outline) => {
    const bounds = transformedBBox(outline);
    return (
      point.x >= bounds.minX &&
      point.x <= bounds.maxX &&
      point.y >= bounds.minY &&
      point.y <= bounds.maxY
    );
  });
}
