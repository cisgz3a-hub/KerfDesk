import { type Layer, createLayer, defaultLaserSettings } from '../scene/Layer';
import { type SceneObject, createRect } from '../scene/SceneObject';

export interface CalibrationGridOptions {
  /** Material name to associate with the resulting curve. */
  materialName: string;
  /** Scan speed in mm/min, single value for Phase 1. */
  scanSpeed: number;
  /** Number of power steps (grid columns). Default 10. */
  powerSteps?: number;
  /** Lowest commanded power in the grid, percent. Default 5. */
  powerMin?: number;
  /** Highest commanded power in the grid, percent. Default 95. */
  powerMax?: number;
  /** Side length of each burn square in mm. Default 10. */
  squareSize?: number;
  /** Gap between squares in mm. Default 3. */
  gap?: number;
  /** Top-left corner in machine coords (mm). Default { x: 10, y: 10 }. */
  origin?: { x: number; y: number };
}

export interface CalibrationGridResult {
  objects: SceneObject[];
  layers: Layer[];
  squares: Array<{
    index: number;
    commandedPower: number;
    bounds: { x: number; y: number; width: number; height: number };
  }>;
}

function formatPowerLabel(power: number): string {
  return `${Math.round(power).toString().padStart(2, '0')}%`;
}

function getLinearPower(powerMin: number, powerMax: number, i: number, steps: number): number {
  if (steps === 1) return powerMin;
  return powerMin + ((powerMax - powerMin) * i) / (steps - 1);
}

export function emitCalibrationGrid(opts: CalibrationGridOptions): CalibrationGridResult {
  const powerSteps = opts.powerSteps ?? 10;
  const powerMin = opts.powerMin ?? 5;
  const powerMax = opts.powerMax ?? 95;
  const squareSize = opts.squareSize ?? 10;
  const gap = opts.gap ?? 3;
  const origin = opts.origin ?? { x: 10, y: 10 };

  if (opts.scanSpeed <= 0) throw new Error('scanSpeed must be > 0');
  if (powerSteps < 2) throw new Error('powerSteps must be >= 2');
  if (powerMin >= powerMax) throw new Error('powerMin must be < powerMax');
  if (squareSize <= 0) throw new Error('squareSize must be > 0');

  const columns = Math.min(powerSteps, 12);
  const objects: SceneObject[] = [];
  const layers: Layer[] = [];
  const squares: CalibrationGridResult['squares'] = [];

  for (let i = 0; i < powerSteps; i++) {
    const row = Math.floor(i / columns);
    const col = i % columns;
    const x = origin.x + col * (squareSize + gap);
    const y = origin.y + row * (squareSize + gap);
    const commandedPower = getLinearPower(powerMin, powerMax, i, powerSteps);

    const layer = createLayer(i, 'engrave', `Calib ${formatPowerLabel(commandedPower)}`);
    layer.settings = defaultLaserSettings('engrave');
    layer.settings.speed = opts.scanSpeed;
    layer.settings.power.min = commandedPower;
    layer.settings.power.max = commandedPower;
    layers.push(layer);

    const object = createRect(layer.id, x, y, squareSize, squareSize, `Calib Square ${i + 1}`);
    objects.push(object);

    squares.push({
      index: i,
      commandedPower,
      bounds: {
        x,
        y,
        width: squareSize,
        height: squareSize,
      },
    });
  }

  return { objects, layers, squares };
}
