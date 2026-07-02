// detectCncRasterWarnings — CNC-mode advisory: raster images on
// output-enabled layers are silently ignored by the CNC compiler (a router
// has no raster mode; compile-cnc-job skips them by design — ADR-100 §4).
// Non-blocking: vector artwork on those layers still cuts, and the operator
// may keep bitmaps as visual reference.

import type { Project } from '../../core/scene';

export function detectCncRasterWarnings(project: Project): ReadonlyArray<string> {
  if (project.machine?.kind !== 'cnc') return [];
  const outputColors = new Set(
    project.scene.layers.filter((layer) => layer.output).map((layer) => layer.color),
  );
  const droppedCount = project.scene.objects.filter(
    (object) =>
      object.kind === 'raster-image' &&
      object.role !== 'trace-source' &&
      outputColors.has(object.color),
  ).length;
  if (droppedCount === 0) return [];
  const noun = droppedCount === 1 ? 'raster image' : 'raster images';
  return [
    `${droppedCount} ${noun} on output-enabled layers will be skipped — a ` +
      'router has no raster engrave mode. Vector artwork on those layers ' +
      'still cuts; switch to Laser mode to engrave images.',
  ];
}
