import type { MaterialTestGrid } from '../../core/job';
import { captureProcessRecipe } from '../../core/material-library/capture-process-recipe';
import type {
  ExperimentCell,
  MaterialExperiment,
} from '../../core/material-library/material-experiment';
import { machineKindOf, type Project } from '../../core/scene';
import { transformedBounds } from '../../core/scene/hit-test';

export function captureGridExperiment(
  project: Project,
  grid: MaterialTestGrid,
  id: string,
  createdAt: string,
): MaterialExperiment {
  const source: Project = { ...project, machine: { kind: 'laser' }, scene: grid.scene };
  const cells = grid.cells.map((cell): ExperimentCell => {
    const process = captureProcessRecipe(source, cell.objectId, {
      id: `${id}-${cell.row}-${cell.column}`,
      name: `Cell ${cell.row + 1}, ${cell.column + 1}`,
      description: '',
      revision: '1',
    });
    if (process.kind === 'invalid') throw new Error(process.reason);
    return {
      id: `${cell.row}-${cell.column}`,
      row: cell.row,
      column: cell.column,
      objectId: cell.objectId,
      bounds: cell.bounds,
      requestedFeed: cell.requestedSpeed,
      effectiveFeed: cell.effectiveSpeed,
      observation: '',
      process: {
        ...process.value,
        steps: process.value.steps.map((step) => ({
          ...step,
          settings: { ...step.settings, speed: cell.effectiveSpeed },
        })),
      },
    };
  });
  return {
    ...experimentHeader(project, id, createdAt),
    source: 'grid',
    machineKind: 'laser',
    axes: `${grid.rowParameter} by row / ${grid.columnParameter} by column`,
    cells,
  };
}

export function captureArtworkExperiment(
  project: Project,
  objectId: string,
  id: string,
  createdAt: string,
): MaterialExperiment {
  const object = project.scene.objects.find((item) => item.id === objectId);
  if (object === undefined) throw new Error('Select one artwork to record its process.');
  const process = captureProcessRecipe(project, objectId, {
    id: `${id}-process`,
    name: 'Tested process',
    description: '',
    revision: '1',
  });
  if (process.kind === 'invalid') throw new Error(process.reason);
  const box = transformedBounds(object.bounds, object.transform);
  const step = process.value.steps[0];
  const settings = step?.settings;
  if (settings === undefined) throw new Error('The artwork has no process settings.');
  const feed = step?.cnc?.feedMmPerMin ?? settings.speed;
  return {
    ...experimentHeader(project, id, createdAt),
    source: 'artwork',
    machineKind: machineKindOf(project.machine),
    cells: [
      {
        id: '0-0',
        row: 0,
        column: 0,
        objectId,
        bounds: { minX: box.minX, minY: box.minY, maxX: box.maxX, maxY: box.maxY },
        requestedFeed: feed,
        effectiveFeed: feed,
        observation: '',
        process: process.value,
      },
    ],
  };
}

function experimentHeader(
  project: Project,
  id: string,
  createdAt: string,
): Omit<MaterialExperiment, 'source' | 'machineKind' | 'cells'> {
  const material =
    project.machine?.kind === 'cnc'
      ? (project.machine.stock.materialKey ?? '')
      : (project.jobSetup.laserMaterial?.name ?? '');
  const head = project.device.laserSubProfile;
  return {
    id,
    createdAt,
    name: `Experiment ${createdAt.slice(0, 10)}`,
    deviceName: project.device.name,
    ...(project.device.profileId === undefined ? {} : { profileId: project.device.profileId }),
    ...(head === undefined
      ? {}
      : {
          headDescription: [
            head.model,
            head.technology,
            head.opticalPowerW === undefined ? '' : `${head.opticalPowerW} W`,
            head.wavelengthNm === undefined ? '' : `${head.wavelengthNm} nm`,
          ]
            .filter(Boolean)
            .join(' / '),
        }),
    material,
    batch: '',
    notes: '',
  };
}
