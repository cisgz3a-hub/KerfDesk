// Laser-mode advisory for relief geometry that remains durable but is omitted
// by the laser compiler. Warning-only: vector artwork still emits unchanged.

import {
  machineKindOf,
  outputOperationLayers,
  sceneObjectUsesOperation,
  type Project,
} from '../../core/scene';

export function detectLaserReliefWarnings(project: Project): ReadonlyArray<string> {
  if (machineKindOf(project.machine) !== 'laser') return [];
  const outputOperations = project.scene.layers.flatMap(outputOperationLayers);
  const droppedCount = project.scene.objects.filter(
    (object) =>
      object.kind === 'relief' &&
      outputOperations.some((operation) => sceneObjectUsesOperation(object, operation)),
  ).length;
  if (droppedCount === 0) return [];
  const noun = droppedCount === 1 ? 'relief object' : 'relief objects';
  const retention = droppedCount === 1 ? 'It remains stored' : 'They remain stored';
  return [
    `Laser output will omit ${droppedCount} ${noun} on output-enabled operations because ` +
      `reliefs have no laser toolpath. ${retention}; switch to CNC mode to carve ` +
      `${droppedCount === 1 ? 'it' : 'them'}.`,
  ];
}
