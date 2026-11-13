// Photo engraving edits the photo's settings on one operation only (ADR-581
// decision 7 keeps sub-operations as they are). A photo that also burns
// through another output operation, or through an enabled image sub-pass of
// this one, burns there with its own marking, dither and DPI: with Light marks
// the photo then burned its negative and its positive on top of each other
// (tools audit T1, T15-P2-1, T15R-P2-1). The window names those burns.

import { sceneObjectUsesOperation, type Layer, type SceneObject } from '../../core/scene';

/** The other burns of `image`, as names to show: operations, then sub-passes. */
export function otherPhotoBurns(
  image: SceneObject,
  operation: Layer,
  layers: ReadonlyArray<Layer>,
): readonly string[] {
  const operations = layers
    .filter(
      (layer) =>
        layer.id !== operation.id && layer.output && sceneObjectUsesOperation(image, layer),
    )
    .map((layer) => `operation “${layer.name}”`);
  const subPasses = operation.subLayers
    .filter((sub) => sub.enabled && sub.settings.mode === 'image')
    .map((sub) => `sub-pass “${sub.label}”`);
  return [...operations, ...subPasses];
}

/** One sentence naming the other burns, or null when there are none. */
export function otherPhotoBurnsSentence(burns: readonly string[]): string | null {
  if (burns.length === 0) return null;
  const list =
    burns.length === 1
      ? burns[0]
      : `${burns.slice(0, -1).join(', ')} and ${burns[burns.length - 1] ?? ''}`;
  return `This photo also burns through ${list}, which ${burns.length === 1 ? 'keeps' : 'keep'} its own marking, dither and DPI.`;
}
