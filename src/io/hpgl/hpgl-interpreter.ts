import { drawArc, drawCircle } from './hpgl-arcs';
import { drawPolygon, polygonMode, rectangle } from './hpgl-polygons';
import { flushStroke, movePlotterPoint } from './hpgl-paths';
import { plotterPoint, setInputPoints, setScaling } from './hpgl-scaling';
import {
  finitePoint,
  HpglError,
  PLOTTER_MAPPING,
  requireArgs,
  type HpglCommand,
  type HpglState,
} from './hpgl-types';

type Handler = (state: HpglState) => void;
const HANDLERS: Readonly<Record<string, Handler>> = {
  IN: (state) => reset(state, true),
  DF: (state) => reset(state, false),
  CO: () => undefined,
  PA: plot,
  PR: plot,
  PU: plot,
  PD: plot,
  SP: selectPen,
  IP: setInputPoints,
  SC: setScaling,
  CI: drawCircle,
  AA: drawArc,
  AR: drawArc,
  EA: rectangle,
  ER: rectangle,
  RA: rectangle,
  RR: rectangle,
  PM: polygonMode,
  EP: (state) => drawPolygon(state, false),
  FP: (state) => drawPolygon(state, true),
  LT: continuousLine,
  FT: solidFill,
};
const POLYGON_COMMANDS = new Set([
  'IN',
  'DF',
  'CO',
  'PA',
  'PR',
  'PU',
  'PD',
  'CI',
  'AA',
  'AR',
  'PM',
]);

export function createHpglState(): HpglState {
  return {
    command: { name: 'IN', values: [], offset: 0 },
    position: { x: 0, y: 0 },
    pen: 0,
    down: false,
    relative: false,
    mapping: PLOTTER_MAPPING,
    p1: null,
    p2: null,
    scaling: null,
    polygonMode: false,
    polygon: [],
    contour: null,
    active: null,
    paths: [],
    workPoints: 0,
    outputPoints: 0,
    diagnostics: new Map(),
  };
}

export function executeHpgl(state: HpglState, command: HpglCommand): void {
  state.command = command;
  if (state.polygonMode && !POLYGON_COMMANDS.has(command.name)) {
    throw new HpglError(
      'invalid-polygon-command',
      'Exit polygon mode with PM2 before this command.',
      command,
    );
  }
  const handler = HANDLERS[command.name];
  if (handler === undefined)
    throw new HpglError('unsupported-command', `Unsupported command ${command.name}.`, command);
  handler(state);
}

function reset(state: HpglState, initialize: boolean): void {
  requireArgs(state.command, [0]);
  flushStroke(state);
  state.mapping = PLOTTER_MAPPING;
  state.scaling = null;
  state.relative = false;
  state.polygonMode = false;
  state.polygon = [];
  state.contour = null;
  if (initialize) {
    state.down = false;
    state.position = { x: 0, y: 0 };
    state.p1 = null;
    state.p2 = null;
  }
}

function plot(state: HpglState): void {
  const { name, values } = state.command;
  if (values.length % 2 !== 0)
    throw new HpglError(
      'invalid-parameters',
      'Every X coordinate needs a Y coordinate.',
      state.command,
    );
  if (name === 'PA') state.relative = false;
  if (name === 'PR') state.relative = true;
  if (name === 'PD') state.down = true;
  if (name === 'PU') {
    flushStroke(state);
    state.down = false;
  }
  for (let index = 0; index < values.length; index += 2) {
    const x = values[index] ?? 0;
    const y = values[index + 1] ?? 0;
    const point = state.relative
      ? finitePoint(
          {
            x: state.position.x + x * state.mapping.sx,
            y: state.position.y + y * state.mapping.sy,
          },
          state.command,
        )
      : plotterPoint(state, { x, y });
    movePlotterPoint(state, point);
  }
}

function selectPen(state: HpglState): void {
  requireArgs(state.command, [0, 1]);
  const pen = state.command.values[0] ?? 0;
  if (!Number.isSafeInteger(pen) || pen < 0)
    throw new HpglError(
      'invalid-parameters',
      'SP requires a nonnegative integer pen number.',
      state.command,
    );
  flushStroke(state);
  state.pen = pen;
}

function continuousLine(state: HpglState): void {
  if (state.command.values.length !== 0)
    throw new HpglError(
      'unsupported-style',
      'Only continuous LT; lines are supported. Convert patterned strokes to outlines.',
      state.command,
    );
}

function solidFill(state: HpglState): void {
  requireArgs(state.command, [0, 1]);
  const fill = state.command.values[0] ?? 1;
  if (fill !== 1 && fill !== 2)
    throw new HpglError(
      'unsupported-style',
      'Only solid FT1/FT2 fills are supported. Convert hatch/pattern fills to geometry.',
      state.command,
    );
}
