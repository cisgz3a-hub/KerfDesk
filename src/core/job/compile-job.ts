// Scene/run orchestration. Each materialized vector operation resolves its topology before process buckets.
import type { DeviceProfile } from '../devices';
import { artworkOperationRuns, orderedArtworkObjects } from '../artwork-order';
import { outputOperationLayers, type Layer, type Scene, type SceneObject } from '../scene';
import { compileRasterGroupsForLayer } from './compile-job-raster';
import { contourEntryBoundsForDevice, withContourEntryBounds } from './contour-entry';
import { registrationJigCompilationRuns } from './registration-jig-compilation-runs';
import type { LaserPowerScaleVersion } from '../output/laser-power-scale-version';
import type { Group, Job, JobDiagnostic } from './job';
import { compileVectorGroupsForLayer } from './compile-vector-operation';
import { focusTestProfileIssue } from './focus-test';
import { FocusTestCompilationError } from './focus-test-compilation-error';

export function compileJob(
  scene: Scene,
  device: DeviceProfile,
  laserPowerScaleVersion: LaserPowerScaleVersion = 2,
): Job {
  const groups: Group[] = [];
  const diagnostics: JobDiagnostic[] = [];
  const output = { groups, diagnostics, vectorRun: 0 };
  const completeSceneObjects = [...scene.objects, ...(scene.outputDependencies ?? [])];
  const jigRuns = registrationJigCompilationRuns(scene);
  if (jigRuns !== null) {
    for (const run of jigRuns) {
      appendOperationCompilation(
        output,
        run.vectorObjects,
        run.rasterObjects,
        run.layer,
        device,
        run.priorityObjectId,
        completeSceneObjects,
        laserPowerScaleVersion,
      );
    }
    return withContourEntryBounds(
      diagnostics.length === 0 ? { groups } : { groups, diagnostics },
      contourEntryBoundsForDevice(device),
    );
  }
  const orderedObjects = orderedArtworkObjects(scene);
  for (const { layer, priorityObjectId } of artworkOperationRuns(scene)) {
    appendOperationCompilation(
      output,
      scene.objects,
      orderedObjects,
      layer,
      device,
      priorityObjectId,
      completeSceneObjects,
      laserPowerScaleVersion,
    );
  }
  return withContourEntryBounds(
    diagnostics.length === 0 ? { groups } : { groups, diagnostics },
    contourEntryBoundsForDevice(device),
  );
}

function appendOperationCompilation(
  output: { readonly groups: Group[]; readonly diagnostics: JobDiagnostic[]; vectorRun: number },
  vectorObjects: ReadonlyArray<SceneObject>,
  rasterObjects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
  priorityObjectId: string,
  completeSceneObjects: ReadonlyArray<SceneObject>,
  laserPowerScaleVersion: LaserPowerScaleVersion,
): void {
  for (const operationLayer of outputOperationLayers(layer)) {
    if (operationLayer.mode !== 'image') {
      const vector = compileVectorGroupsForLayer(
        vectorObjects,
        operationLayer,
        device,
        priorityObjectId,
        `vector:${output.vectorRun++}:${operationLayer.id}`,
      );
      for (const group of vector.groups) {
        if (!hasFocusGeometry(group, operationLayer)) continue;
        assertFocusOperation(operationLayer, device);
        output.groups.push(withFocusMotion(group, operationLayer));
      }
      for (const diagnostic of vector.diagnostics) output.diagnostics.push(diagnostic);
    }
    const raster = compileRasterGroupsForLayer(rasterObjects, operationLayer, device, {
      sceneObjects: completeSceneObjects,
      laserPowerScaleVersion,
    });
    if (operationLayer.focusTest !== undefined && raster.groups.length > 0)
      throw new FocusTestCompilationError(
        'Focus Test operations require vector Line artwork; raster output cannot retain their Z-motion meaning.',
      );
    for (const group of raster.groups) output.groups.push(group);
    for (const diagnostic of raster.diagnostics) output.diagnostics.push(diagnostic);
  }
}

function assertFocusOperation(layer: Layer, device: DeviceProfile): void {
  if (layer.focusTest === undefined) return;
  const issue = focusTestProfileIssue(device);
  if (issue !== null) throw new FocusTestCompilationError(issue);
  if (layer.mode !== 'line')
    throw new FocusTestCompilationError(
      'Focus Test samples require Line mode to retain their Z-motion meaning.',
    );
}

function withFocusMotion(group: Group, layer: Layer): Group {
  if (layer.focusTest === undefined) return group;
  if (group.kind !== 'cut')
    throw new FocusTestCompilationError(
      'Focus Test artwork overrides must retain vector Line mode.',
    );
  return { ...group, focusTest: layer.focusTest };
}

/** Exact geometry only: output rounding must wait until final placement. */
function hasFocusGeometry(group: Group, layer: Layer): boolean {
  if (layer.focusTest === undefined || group.kind !== 'cut') return true;
  return group.segments.some((segment) => {
    const first = segment.polyline[0];
    return (
      first !== undefined &&
      segment.polyline.some((point) => point.x !== first.x || point.y !== first.y)
    );
  });
}
