import { rotaryCircumferenceMm, type RotarySetup } from '../devices';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
  type Scene,
} from '../scene';

const COLOR = '#0066cc';
const WIDTH_MM = 50;
const TARGET_HEIGHT_MM = 20;

export type RotaryCalibrationPattern = {
  readonly scene: Scene;
  readonly widthMm: number;
  readonly heightMm: number;
};

export function generateRotaryCalibrationPattern(setup: RotarySetup): RotaryCalibrationPattern {
  const circumference = rotaryCircumferenceMm(setup);
  const heightMm = Math.min(TARGET_HEIGHT_MM, circumference / 2);
  const polylines = calibrationPolylines(WIDTH_MM, heightMm);
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'rotary-calibration-pattern',
    source: 'Rotary calibration pattern',
    operationIds: ['rotary-calibration'],
    bounds: { minX: 0, minY: 0, maxX: WIDTH_MM, maxY: heightMm },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: COLOR, polylines }],
  };
  const layer = {
    ...createLayer({
      id: 'rotary-calibration',
      name: 'Rotary calibration',
      color: COLOR,
      mode: 'line',
    }),
    power: 10,
    speed: 1500,
  };
  return { scene: { objects: [object], layers: [layer] }, widthMm: WIDTH_MM, heightMm };
}

function calibrationPolylines(width: number, height: number): ReadonlyArray<Polyline> {
  return [
    {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
      ],
    },
    {
      closed: false,
      points: [
        { x: width / 2, y: 0 },
        { x: width / 2, y: height },
      ],
    },
    {
      closed: false,
      points: [
        { x: 0, y: height / 2 },
        { x: width, y: height / 2 },
      ],
    },
  ];
}
