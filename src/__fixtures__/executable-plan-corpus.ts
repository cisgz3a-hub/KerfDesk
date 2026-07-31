import type {
  ExecutablePlanController,
  ExecutablePlanMotionIntent,
  ExecutablePlanMotionMode,
  ExecutablePlanPoint,
} from '../core/execution-plan';
import type { MachineKind } from '../core/scene';

export type ExecutablePlanCorpusCase = {
  readonly name: string;
  readonly machineKind: MachineKind;
  readonly controller: ExecutablePlanController;
  readonly gcode: string;
  readonly expected: {
    readonly intents: ReadonlyArray<ExecutablePlanMotionIntent>;
    readonly modes: ReadonlyArray<ExecutablePlanMotionMode>;
    readonly finalPosition: ExecutablePlanPoint | null;
    readonly lineEnding: 'none' | 'lf' | 'crlf' | 'cr' | 'mixed';
    readonly programEnded: boolean;
  };
};

/**
 * Deterministic semantic benchmark corpus. These are parser/emitter attacks,
 * not physical qualification coupons and not performance timing fixtures.
 */
export const EXECUTABLE_PLAN_CORPUS: ReadonlyArray<ExecutablePlanCorpusCase> = [
  {
    name: 'laser blank runway, powered process, and terminal park',
    machineKind: 'laser',
    controller: 'grbl',
    gcode: [
      'G21',
      'G90',
      'M4 S0',
      'G0 X1.000 Y1.000',
      'G1 X5.000 Y1.000 F600 S0',
      'G1 X10.000 Y1.000 S500',
      'M5',
      'G0 X0.000 Y0.000',
      'M2',
      '',
    ].join('\n'),
    expected: {
      intents: ['travel', 'travel', 'process', 'park'],
      modes: ['rapid', 'linear', 'linear', 'rapid'],
      finalPosition: { x: 0, y: 0, z: 0 },
      lineEnding: 'lf',
      programEnded: true,
    },
  },
  {
    name: 'same-block spindle transitions execute before motion',
    machineKind: 'laser',
    controller: 'grbl',
    gcode: ['G21 G90', 'M4 S250 G1 X1.000 Y0.000 F100', 'M5 G0 X0.000 Y0.000', 'M2'].join('\n'),
    expected: {
      intents: ['process', 'park'],
      modes: ['linear', 'rapid'],
      finalPosition: { x: 0, y: 0, z: 0 },
      lineEnding: 'lf',
      programEnded: true,
    },
  },
  {
    name: 'powered full-circle arc remains process and exposes terminal park',
    machineKind: 'laser',
    controller: 'grbl',
    gcode: [
      'G21 G90 G17',
      'M4 S200',
      'G2 X0.000 Y0.000 I5.000 J0.000 F100',
      'M5',
      'G0 X2.000 Y2.000',
      'M2',
      '',
    ].join('\n'),
    expected: {
      intents: ['process', 'park'],
      modes: ['clockwise-arc', 'rapid'],
      finalPosition: { x: 2, y: 2, z: 0 },
      lineEnding: 'lf',
      programEnded: true,
    },
  },
  {
    name: 'inch input and relative motion normalize to absolute millimetres',
    machineKind: 'laser',
    controller: 'grbl',
    gcode: [
      'G20 G90',
      'M3 S100',
      'G1 X1 Y0 F60',
      'G91',
      'G1 X0 Y1 S0',
      'G90',
      'M5',
      'G0 X0 Y0',
      'M30',
      '',
    ].join('\n'),
    expected: {
      intents: ['process', 'travel', 'park'],
      modes: ['linear', 'linear', 'rapid'],
      finalPosition: { x: 0, y: 0, z: 0 },
      lineEnding: 'lf',
      programEnded: true,
    },
  },
  {
    name: 'CNC full-circle and helical arcs with coolant and retract',
    machineKind: 'cnc',
    controller: 'grbl-cnc',
    gcode: [
      'G21 G90 G17',
      'M3 S12000',
      'M8',
      'G0 X5.000 Y0.000 Z5.000',
      'G1 Z-1.000 F100',
      'G2 X5.000 Y0.000 I-5.000 J0.000 F300',
      'G3 X0.000 Y5.000 Z-2.000 I-5.000 J0.000',
      'G0 Z5.000',
      'M9',
      'M5',
      'G0 X0.000 Y0.000',
      'M30',
      '',
    ].join('\n'),
    expected: {
      intents: ['travel', 'plunge', 'process', 'process', 'retract', 'park'],
      modes: ['rapid', 'linear', 'clockwise-arc', 'counterclockwise-arc', 'rapid', 'rapid'],
      finalPosition: { x: 0, y: 0, z: 5 },
      lineEnding: 'lf',
      programEnded: true,
    },
  },
  {
    name: 'Marlin fan power remains process semantics',
    machineKind: 'laser',
    controller: 'marlin',
    gcode: ['G21 G90', 'M106 S128', 'G1 X10.000 F500', 'M107', 'G0 X0.000', 'M2', ''].join('\r\n'),
    expected: {
      intents: ['process', 'park'],
      modes: ['linear', 'rapid'],
      finalPosition: { x: 0, y: 0, z: 0 },
      lineEnding: 'crlf',
      programEnded: true,
    },
  },
  {
    name: 'comments, Unicode, negative coordinates, tiny feeds, and mixed endings',
    machineKind: 'laser',
    controller: 'smoothieware',
    gcode:
      '; micro sign: µ\n' +
      'G21\r\n' +
      'G90\r' +
      'M4 S0\n' +
      'G0 X-0.001 Y0.001\r\n' +
      'G1 X0.000 Y0.002 F1 S0\n' +
      'M5\r\n',
    expected: {
      intents: ['travel', 'travel'],
      modes: ['rapid', 'linear'],
      finalPosition: { x: 0, y: 0.002, z: 0 },
      lineEnding: 'mixed',
      programEnded: false,
    },
  },
  {
    name: 'tool word, unsupported tool change, and pause retain accountability',
    machineKind: 'cnc',
    controller: 'grbl-cnc',
    gcode: ['G21', 'G90', 'T2 M6', 'M0', 'G0 X1.000 Y1.000', 'M2'].join('\n'),
    expected: {
      intents: ['travel'],
      modes: ['rapid'],
      finalPosition: { x: 1, y: 1, z: 0 },
      lineEnding: 'lf',
      programEnded: true,
    },
  },
];
